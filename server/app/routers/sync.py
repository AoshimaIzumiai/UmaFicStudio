"""
同步路由：push、pull、snapshot、status、trash、restore、export
"""

import json
import tempfile
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.deps import get_db, get_current_user, require_sync_enabled
from app.models.schemas import (
    PushRequest, PushResponse, PushResult,
    SnapshotRequest, SnapshotResponse,
    RestoreRequest,
    SYNCABLE_MODULES,
)
from app.services.sync_service import (
    push_changes, PushError, pull_changes, get_snapshot, SnapshotError, get_status,
    get_trash, restore_record,
)

router = APIRouter(dependencies=[Depends(require_sync_enabled)])


@router.post("/push", response_model=PushResponse)
async def push(
    body: PushRequest,
    request: Request,
    user_id: int = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """推送本地变更"""
    request_id = request.state.request_id

    try:
        results = await push_changes(db, user_id, body.module, body.changes)
    except PushError as exc:
        raise HTTPException(
            status_code=exc.status_code,
            detail={
                "code": exc.code,
                "message": exc.message,
                "details": exc.details,
                "request_id": request_id,
            },
        ) from exc

    return PushResponse(
        results=[PushResult(**result) for result in results],
        request_id=request_id,
    )


@router.get("/pull")
async def pull(
    request: Request,
    cursor: int = Query(default=0, ge=0),
    limit: int = Query(default=500, ge=1, le=1000),
    user_id: int = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """拉取增量变更（cursor 分页）"""
    result = await pull_changes(db, user_id, cursor, limit)
    return {**result, "request_id": request.state.request_id}


@router.post("/snapshot", response_model=SnapshotResponse)
async def snapshot(
    body: SnapshotRequest,
    request: Request,
    user_id: int = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """请求或续传物化快照"""
    request_id = request.state.request_id
    try:
        result = await get_snapshot(
            db, user_id, body.snapshot_token, body.cursor
        )
    except SnapshotError as exc:
        raise HTTPException(
            status_code=exc.status_code,
            detail={
                "code": exc.code,
                "message": exc.message,
                "request_id": request_id,
            },
        ) from exc

    return SnapshotResponse(**result, request_id=request_id)


@router.get("/status")
async def status(
    request: Request,
    user_id: int = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """获取同步状态和配额使用情况"""
    result = await get_status(db, user_id)
    return {**result, "request_id": request.state.request_id}


@router.get("/trash")
async def trash(
    request: Request,
    module: str | None = Query(default=None),
    cursor: int = Query(default=0, ge=0),
    limit: int = Query(default=50, ge=1, le=100),
    user_id: int = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """列出回收站（7 天内可恢复的删除记录）"""
    if module and module not in SYNCABLE_MODULES:
        raise HTTPException(400, detail={
            "code": "VALIDATION_ERROR", "message": f"Invalid module: {module}",
        })

    result = await get_trash(db, user_id, module, cursor, limit)
    return {**result, "request_id": request.state.request_id}


@router.post("/restore")
async def restore(
    body: RestoreRequest,
    request: Request,
    user_id: int = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """从回收站恢复记录"""
    request_id = request.state.request_id
    result = await restore_record(db, user_id, body.module, body.id, body.base_delete_revision)

    if "error" in result:
        code = result["error"]
        status_map = {"NOT_FOUND": 404, "RESTORE_CONFLICT": 409, "QUOTA_EXCEEDED": 413}
        raise HTTPException(
            status_code=status_map.get(code, 500),
            detail={"code": code, "message": code, "request_id": request_id},
        )

    return {**result, "request_id": request_id}


@router.get("/export")
async def export(
    request: Request,
    user_id: int = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """导出全部用户数据为 JSON；响应启动前完成查询与序列化。"""
    from sqlalchemy import text as sql_text
    request_id = request.state.request_id
    export_file = tempfile.SpooledTemporaryFile(max_size=1024 * 1024, mode="w+b")

    def write_json(value):
        export_file.write(json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode("utf-8"))

    try:
        export_file.write(b'{"version":"1.0","exported_at":')
        write_json(datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"))
        export_file.write(b',"modules":{')
        first_mod = True
        for mod in sorted(SYNCABLE_MODULES):
            if not first_mod:
                export_file.write(b',')
            first_mod = False
            write_json(mod)
            export_file.write(b':[')

            result = await db.execute(
                sql_text("SELECT record_id, data FROM sync_data "
                         "WHERE user_id = :uid AND module = :mod AND is_tombstone = 0 AND data IS NOT NULL"),
                {"uid": user_id, "mod": mod},
            )
            first_item = True
            for row in result.fetchall():
                if not first_item:
                    export_file.write(b',')
                first_item = False
                data = row[1]
                if isinstance(data, (str, bytes, bytearray)):
                    data = json.loads(data)
                write_json({"id": row[0], "data": data})
            export_file.write(b']')
        export_file.write(b'}}')
        content_length = export_file.tell()
        export_file.seek(0)
    except Exception:
        export_file.close()
        raise

    async def generate():
        try:
            while chunk := export_file.read(64 * 1024):
                yield chunk
        finally:
            export_file.close()

    return StreamingResponse(
        generate(),
        media_type="application/json",
        headers={
            "Content-Disposition": f"attachment; filename=umafic_export_{request_id}.json",
            "Content-Length": str(content_length),
        },
    )
