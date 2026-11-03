"""
同步服务：push/pull/snapshot/status/trash/restore 业务逻辑
"""

import hashlib
import json
import secrets
import uuid
from datetime import datetime, timedelta, timezone

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_config

# 模块白名单
SYNCABLE_MODULES = frozenset([
    "horses", "dam_groups", "races", "results",
    "farms", "trainers", "owners", "countries", "jockeys",
])


def _new_restore_op_id() -> str:
    """生成不依赖时间、进程或记录 ID 的唯一 restore 日志标识。"""
    return f"restore_{uuid.uuid4().hex}"


def _utcnow_naive() -> datetime:
    """从timezone-aware UTC来源生成与MySQL DATETIME兼容的naive UTC。"""
    return datetime.now(timezone.utc).replace(tzinfo=None)


async def get_min_available_revision(db: AsyncSession, user_id: int) -> int:
    """获取可靠 retention floor；即使日志已全部删除也不会回退为 0。"""
    result = await db.execute(
        text(
            "SELECT GREATEST("
            "COALESCE((SELECT min_available_revision FROM sync_retention_state "
            "WHERE user_id = :uid), 0), "
            "COALESCE((SELECT MIN(revision) FROM sync_changes "
            "WHERE user_id = :uid), 0))"
        ),
        {"uid": user_id},
    )
    return int(result.scalar() or 0)


async def get_current_revision(db: AsyncSession, user_id: int) -> int:
    """获取用户可见全局 revision 高水位；日志清理后也不得回退。"""
    result = await db.execute(
        text(
            "SELECT GREATEST("
            "COALESCE((SELECT min_available_revision FROM sync_retention_state "
            "WHERE user_id = :uid), 0), "
            "COALESCE((SELECT MAX(revision) FROM sync_changes "
            "WHERE user_id = :uid), 0), "
            "COALESCE((SELECT MAX(revision) FROM sync_data "
            "WHERE user_id = :uid), 0))"
        ),
        {"uid": user_id},
    )
    return int(result.scalar() or 0)


async def get_user_total_size(db: AsyncSession, user_id: int) -> int:
    """计算用户数据总字节数（JSON UTF-8）。"""
    result = await db.execute(
        text("SELECT COALESCE(SUM(LENGTH(data)), 0) FROM sync_data "
             "WHERE user_id = :uid AND data IS NOT NULL"),
        {"uid": user_id},
    )
    return int(result.scalar() or 0)


async def get_user_total_size_locked(db: AsyncSession, user_id: int) -> int:
    """在用户行锁之后用锁定当前读计算配额，避免读取认证阶段建立的旧快照。"""
    result = await db.execute(
        text("SELECT COALESCE(SUM(LENGTH(data)), 0) FROM sync_data "
             "WHERE user_id = :uid AND data IS NOT NULL FOR UPDATE"),
        {"uid": user_id},
    )
    return int(result.scalar() or 0)


# === Push ===


class PushError(Exception):
    def __init__(self, code: str, status_code: int, message: str, details: dict | None = None):
        super().__init__(message)
        self.code = code
        self.status_code = status_code
        self.message = message
        self.details = details


async def push_changes(db: AsyncSession, user_id: int, module: str, changes: list) -> list:
    """
    处理 push 请求。在事务内：用户行锁 → op_id 去重 → tombstone 检查 → 写入。
    所有大小校验在任何 SQL 写入前完成。
    """
    config = get_config()
    results = []

    request_size = len(json.dumps({
        "module": module,
        "changes": [change.model_dump() for change in changes],
    }, ensure_ascii=False, separators=(",", ":")).encode("utf-8"))
    if request_size > config.MAX_PUSH_REQUEST_BYTES:
        raise PushError(
            "PUSH_REQUEST_TOO_LARGE", 413, "Push request is too large",
            {"max_bytes": config.MAX_PUSH_REQUEST_BYTES, "actual_bytes": request_size},
        )

    for change in changes:
        if change.data is not None:
            data_size = len(json.dumps(
                change.data, ensure_ascii=False, separators=(",", ":")
            ).encode("utf-8"))
            if data_size > config.MAX_RECORD_BYTES:
                raise PushError(
                    "RECORD_TOO_LARGE", 413, "Record is too large",
                    {"op_id": change.op_id, "max_bytes": config.MAX_RECORD_BYTES,
                     "actual_bytes": data_size},
                )

    # 锁定用户行，使同一用户的并发 push/restore 配额检查串行化。
    await db.execute(
        text("SELECT id FROM users WHERE id = :uid FOR UPDATE"), {"uid": user_id}
    )

    for change in changes:
        op_id = change.op_id
        record_id = change.id
        action = change.action

        # op_id 去重
        dup = await db.execute(
            text("SELECT revision FROM sync_changes WHERE user_id = :uid AND op_id = :op_id"),
            {"uid": user_id, "op_id": op_id},
        )
        dup_row = dup.fetchone()
        if dup_row:
            results.append({"op_id": op_id, "status": "duplicate", "revision": dup_row[0]})
            continue

        # 获取当前状态
        current = await db.execute(
            text("SELECT id, revision, is_tombstone FROM sync_data "
                 "WHERE user_id = :uid AND module = :mod AND record_id = :rid"),
            {"uid": user_id, "mod": module, "rid": record_id},
        )
        current_row = current.fetchone()

        if action == "upsert":
            # tombstone fence 检查
            if current_row and current_row[2]:  # is_tombstone
                results.append({
                    "op_id": op_id, "status": "deleted_conflict",
                    "id": record_id, "delete_revision": current_row[1],
                })
                continue

            # 分配 revision 并写入
            rev_result = await db.execute(
                text("INSERT INTO sync_changes (user_id, module, record_id, action, data, op_id) "
                     "VALUES (:uid, :mod, :rid, 'upsert', :data, :op_id)"),
                {"uid": user_id, "mod": module, "rid": record_id,
                 "data": json.dumps(change.data, ensure_ascii=False) if change.data else None,
                 "op_id": op_id},
            )
            new_rev = rev_result.lastrowid

            # upsert sync_data
            if current_row:
                await db.execute(
                    text("UPDATE sync_data SET data = :data, revision = :rev, "
                         "deleted_at = NULL, is_tombstone = 0 "
                         "WHERE user_id = :uid AND module = :mod AND record_id = :rid"),
                    {"data": json.dumps(change.data, ensure_ascii=False) if change.data else None,
                     "rev": new_rev, "uid": user_id, "mod": module, "rid": record_id},
                )
            else:
                await db.execute(
                    text("INSERT INTO sync_data (user_id, module, record_id, data, revision, is_tombstone) "
                         "VALUES (:uid, :mod, :rid, :data, :rev, 0)"),
                    {"uid": user_id, "mod": module, "rid": record_id,
                     "data": json.dumps(change.data, ensure_ascii=False) if change.data else None,
                     "rev": new_rev},
                )

            results.append({"op_id": op_id, "status": "accepted", "revision": new_rev})

        elif action == "delete":
            # 分配 revision
            rev_result = await db.execute(
                text("INSERT INTO sync_changes (user_id, module, record_id, action, data, op_id) "
                     "VALUES (:uid, :mod, :rid, 'delete', NULL, :op_id)"),
                {"uid": user_id, "mod": module, "rid": record_id, "op_id": op_id},
            )
            new_rev = rev_result.lastrowid

            # 标记 tombstone
            if current_row:
                await db.execute(
                    text("UPDATE sync_data SET revision = :rev, deleted_at = NOW(), is_tombstone = 1 "
                         "WHERE user_id = :uid AND module = :mod AND record_id = :rid"),
                    {"rev": new_rev, "uid": user_id, "mod": module, "rid": record_id},
                )
            else:
                await db.execute(
                    text("INSERT INTO sync_data (user_id, module, record_id, data, revision, deleted_at, is_tombstone) "
                         "VALUES (:uid, :mod, :rid, NULL, :rev, NOW(), 1)"),
                    {"uid": user_id, "mod": module, "rid": record_id, "rev": new_rev},
                )

            results.append({"op_id": op_id, "status": "accepted", "revision": new_rev})

    # 配额检查
    total = await get_user_total_size_locked(db, user_id)
    if total > config.QUOTA_BYTES:
        await db.rollback()
        raise PushError(
            "QUOTA_EXCEEDED", 413, "存储配额已满",
            {"quota_bytes": config.QUOTA_BYTES, "actual_bytes": total},
        )

    await db.commit()
    return results


# === Pull ===

async def pull_changes(db: AsyncSession, user_id: int, cursor: int, limit: int) -> dict:
    """cursor 分页拉取变更"""
    min_rev = await get_min_available_revision(db, user_id)

    if cursor > 0 and cursor < min_rev:
        return {
            "changes": [], "next_cursor": cursor, "has_more": False,
            "min_available_revision": min_rev, "reset_required": True,
        }

    result = await db.execute(
        text("SELECT sc.revision, sc.module, sc.record_id, sc.action, sc.data, "
             "sd.deleted_at "
             "FROM sync_changes sc "
             "LEFT JOIN sync_data sd ON sd.user_id = sc.user_id AND sd.module = sc.module AND sd.record_id = sc.record_id "
             "WHERE sc.user_id = :uid AND sc.revision > :cursor "
             "ORDER BY sc.revision ASC LIMIT :lim"),
        {"uid": user_id, "cursor": cursor, "lim": limit + 1},
    )
    rows = result.fetchall()

    has_more = len(rows) > limit
    if has_more:
        rows = rows[:limit]

    changes = []
    for row in rows:
        change = {
            "revision": row[0], "module": row[1], "id": row[2],
            "action": row[3],
        }
        if row[4]:  # data
            change["data"] = json.loads(row[4]) if isinstance(row[4], str) else row[4]
        if row[5]:  # deleted_at
            change["deleted_at"] = row[5].isoformat()
        changes.append(change)

    next_cursor = rows[-1][0] if rows else cursor

    return {
        "changes": changes, "next_cursor": next_cursor, "has_more": has_more,
        "min_available_revision": min_rev, "reset_required": False,
    }


# === Snapshot ===


class SnapshotError(Exception):
    """可映射为稳定 HTTP 错误的 snapshot 异常。"""

    def __init__(self, code: str, status_code: int, message: str):
        super().__init__(message)
        self.code = code
        self.status_code = status_code
        self.message = message


def _snapshot_token_hash(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def _json_value(value):
    if isinstance(value, (str, bytes, bytearray)):
        return json.loads(value)
    return value


async def _read_snapshot_page(
    db: AsyncSession,
    snapshot_id: int,
    after_sort_key: int,
    page_size: int,
) -> dict:
    result = await db.execute(
        text(
            "SELECT sort_key, module, record_id, data, revision "
            "FROM sync_snapshot_items "
            "WHERE snapshot_id = :snapshot_id AND sort_key > :cursor "
            "ORDER BY sort_key ASC LIMIT :lim"
        ),
        {"snapshot_id": snapshot_id, "cursor": after_sort_key, "lim": page_size + 1},
    )
    rows = result.fetchall()
    has_more = len(rows) > page_size
    rows = rows[:page_size]
    items = [
        {
            "module": row[1],
            "id": row[2],
            "data": _json_value(row[3]),
            "revision": row[4],
        }
        for row in rows
    ]
    return {
        "items": items,
        "next_cursor": rows[-1][0] if rows else None,
        "has_more": has_more,
    }


async def _continue_snapshot(
    db: AsyncSession,
    user_id: int,
    token: str,
    cursor: int | None,
) -> dict:
    config = get_config()
    token_hash = _snapshot_token_hash(token)
    result = await db.execute(
        text(
            "SELECT id, user_id, snapshot_revision, total_items, expires_at "
            "FROM sync_snapshots WHERE token_hash = :token_hash"
        ),
        {"token_hash": token_hash},
    )
    row = result.fetchone()
    if not row:
        raise SnapshotError("SNAPSHOT_INVALID", 404, "Snapshot token is invalid")
    if row[1] != user_id:
        raise SnapshotError("SNAPSHOT_FORBIDDEN", 403, "Snapshot belongs to another user")
    if row[4] <= _utcnow_naive():
        await db.execute(text("DELETE FROM sync_snapshots WHERE id = :id"), {"id": row[0]})
        await db.commit()
        raise SnapshotError("SNAPSHOT_EXPIRED", 410, "Snapshot has expired")

    page = await _read_snapshot_page(
        db, row[0], cursor if cursor is not None else -1, config.SNAPSHOT_PAGE_SIZE
    )
    return {
        "snapshot_token": token,
        "snapshot_revision": row[2],
        "total_items": row[3],
        **page,
    }


async def _prune_snapshots_before_create(db: AsyncSession, user_id: int) -> None:
    """清除过期快照，并限制单用户活跃快照数量，避免重复请求放大存储。"""
    config = get_config()
    now = _utcnow_naive()
    await db.execute(text("DELETE FROM sync_snapshots WHERE expires_at <= :now"), {"now": now})

    result = await db.execute(
        text(
            "SELECT id FROM sync_snapshots WHERE user_id = :uid "
            "ORDER BY created_at DESC, id DESC"
        ),
        {"uid": user_id},
    )
    active_ids = [row[0] for row in result.fetchall()]
    keep_before_new = max(0, config.SNAPSHOT_MAX_ACTIVE_PER_USER - 1)
    for snapshot_id in active_ids[keep_before_new:]:
        await db.execute(
            text("DELETE FROM sync_snapshots WHERE id = :id AND user_id = :uid"),
            {"id": snapshot_id, "uid": user_id},
        )


async def _create_snapshot(db: AsyncSession, user_id: int) -> dict:
    """
    在一个 MySQL REPEATABLE READ 事务中固定 revision 并物化存活记录。
    按 (module, record_id) keyset 分页读取，避免在低内存服务器上一次加载 50MB。
    """
    config = get_config()
    # 与 push/restore 使用同一用户行锁；锁保持到物化和最终 commit，避免并发超出活跃上限。
    await db.execute(
        text("SELECT id FROM users WHERE id = :uid FOR UPDATE"),
        {"uid": user_id},
    )
    try:
        await _prune_snapshots_before_create(db, user_id)
    except Exception:
        await db.rollback()
        raise

    raw_token = secrets.token_urlsafe(32)
    token_hash = _snapshot_token_hash(raw_token)
    expires_at = _utcnow_naive() + timedelta(minutes=config.SNAPSHOT_TTL_MINUTES)

    try:
        # MySQL 默认 REPEATABLE READ；第一个一致性读固定本事务视图。
        snapshot_revision = await get_current_revision(db, user_id)
        meta_result = await db.execute(
            text(
                "INSERT INTO sync_snapshots "
                "(user_id, token_hash, snapshot_revision, total_items, expires_at) "
                "VALUES (:uid, :token_hash, :snapshot_revision, 0, :expires_at)"
            ),
            {
                "uid": user_id,
                "token_hash": token_hash,
                "snapshot_revision": snapshot_revision,
                "expires_at": expires_at,
            },
        )
        snapshot_id = meta_result.lastrowid

        sort_key = 0
        last_module: str | None = None
        last_record_id: str | None = None
        materialize_batch = max(100, min(config.SNAPSHOT_PAGE_SIZE, 1000))

        while True:
            params = {
                "uid": user_id,
                "snapshot_revision": snapshot_revision,
                "lim": materialize_batch,
            }
            key_filter = ""
            if last_module is not None:
                key_filter = (
                    "AND (module > :last_module OR "
                    "(module = :last_module AND record_id > :last_record_id)) "
                )
                params["last_module"] = last_module
                params["last_record_id"] = last_record_id

            result = await db.execute(
                text(
                    "SELECT module, record_id, data, revision FROM sync_data "
                    "WHERE user_id = :uid AND is_tombstone = 0 "
                    "AND deleted_at IS NULL AND data IS NOT NULL "
                    "AND revision <= :snapshot_revision "
                    f"{key_filter}"
                    "ORDER BY module ASC, record_id ASC LIMIT :lim"
                ),
                params,
            )
            rows = result.fetchall()
            if not rows:
                break

            insert_rows = []
            for row in rows:
                value = _json_value(row[2])
                insert_rows.append({
                    "snapshot_id": snapshot_id,
                    "module": row[0],
                    "record_id": row[1],
                    "data": json.dumps(value, ensure_ascii=False, separators=(",", ":")),
                    "revision": row[3],
                    "sort_key": sort_key,
                })
                sort_key += 1

            await db.execute(
                text(
                    "INSERT INTO sync_snapshot_items "
                    "(snapshot_id, module, record_id, data, revision, sort_key) "
                    "VALUES (:snapshot_id, :module, :record_id, :data, :revision, :sort_key)"
                ),
                insert_rows,
            )
            last_module = rows[-1][0]
            last_record_id = rows[-1][1]
            if len(rows) < materialize_batch:
                break

        await db.execute(
            text("UPDATE sync_snapshots SET total_items = :total WHERE id = :id"),
            {"total": sort_key, "id": snapshot_id},
        )
        await db.commit()
    except Exception:
        await db.rollback()
        raise

    page = await _read_snapshot_page(db, snapshot_id, -1, config.SNAPSHOT_PAGE_SIZE)
    return {
        "snapshot_token": raw_token,
        "snapshot_revision": snapshot_revision,
        "total_items": sort_key,
        **page,
    }


async def get_snapshot(
    db: AsyncSession,
    user_id: int,
    snapshot_token: str | None,
    cursor: int | None,
) -> dict:
    """创建物化快照或使用 token 续传既有快照。"""
    if snapshot_token:
        return await _continue_snapshot(db, user_id, snapshot_token, cursor)
    return await _create_snapshot(db, user_id)


# === Status ===

async def get_status(db: AsyncSession, user_id: int) -> dict:
    """获取各模块状态"""
    config = get_config()
    modules = {}
    for mod in SYNCABLE_MODULES:
        result = await db.execute(
            text("SELECT COUNT(*), MAX(revision), COALESCE(SUM(LENGTH(data)),0) "
                 "FROM sync_data WHERE user_id = :uid AND module = :mod AND is_tombstone = 0"),
            {"uid": user_id, "mod": mod},
        )
        row = result.fetchone()
        modules[mod] = {
            "count": row[0] or 0,
            "last_revision": row[1] or 0,
            "size_bytes": row[2] or 0,
        }

    active_total = sum(m["size_bytes"] for m in modules.values())
    total = await get_user_total_size(db, user_id)
    current_rev = await get_current_revision(db, user_id)

    return {
        "modules": modules,
        "active_size_bytes": active_total,
        "total_size_bytes": total,
        "quota_bytes": config.QUOTA_BYTES,
        "current_revision": current_rev,
    }


# === Trash ===

async def get_trash(db: AsyncSession, user_id: int, module: str | None, cursor: int, limit: int) -> dict:
    """获取 7 天内可恢复的删除记录"""
    seven_days_ago = _utcnow_naive() - timedelta(days=7)

    query = ("SELECT record_id, module, data, deleted_at, revision FROM sync_data "
             "WHERE user_id = :uid AND is_tombstone = 1 AND data IS NOT NULL "
             "AND deleted_at >= :since AND revision > :cursor ")
    params = {"uid": user_id, "since": seven_days_ago, "cursor": cursor}

    if module:
        query += "AND module = :mod "
        params["mod"] = module

    query += "ORDER BY revision ASC LIMIT :lim"
    params["lim"] = limit + 1

    result = await db.execute(text(query), params)
    rows = result.fetchall()

    has_more = len(rows) > limit
    if has_more:
        rows = rows[:limit]

    items = []
    for row in rows:
        expires = row[3] + timedelta(days=7) if row[3] else None
        items.append({
            "id": row[0], "module": row[1],
            "data": json.loads(row[2]) if isinstance(row[2], str) else row[2],
            "deleted_at": row[3].isoformat() if row[3] else None,
            "delete_revision": row[4],
            "expires_at": expires.isoformat() if expires else None,
        })

    next_cursor = rows[-1][4] if rows else cursor
    return {"items": items, "next_cursor": next_cursor, "has_more": has_more}


# === Restore ===

async def restore_record(db: AsyncSession, user_id: int, module: str, record_id: str, base_revision: int) -> dict:
    """恢复删除的记录"""
    config = get_config()

    await db.execute(
        text("SELECT id FROM users WHERE id = :uid FOR UPDATE"), {"uid": user_id}
    )

    # 查找 tombstone
    result = await db.execute(
        text("SELECT data, revision, deleted_at FROM sync_data "
             "WHERE user_id = :uid AND module = :mod AND record_id = :rid AND is_tombstone = 1"),
        {"uid": user_id, "mod": module, "rid": record_id},
    )
    row = result.fetchone()

    if not row or not row[0]:  # 不存在或 payload 已过期
        return {"error": "NOT_FOUND"}

    if row[1] != base_revision:
        return {"error": "RESTORE_CONFLICT"}

    # tombstone payload 在恢复前已存在 sync_data 且计入配额；恢复净增量为 0。
    total = await get_user_total_size_locked(db, user_id)
    if total > config.QUOTA_BYTES:
        return {"error": "QUOTA_EXCEEDED"}

    # 复活：清除 tombstone，分配新 revision
    data = row[0]
    op_id = _new_restore_op_id()

    rev_result = await db.execute(
        text("INSERT INTO sync_changes (user_id, module, record_id, action, data, op_id) "
             "VALUES (:uid, :mod, :rid, 'upsert', :data, :op_id)"),
        {"uid": user_id, "mod": module, "rid": record_id, "data": data, "op_id": op_id},
    )
    new_rev = rev_result.lastrowid

    await db.execute(
        text("UPDATE sync_data SET is_tombstone = 0, deleted_at = NULL, revision = :rev "
             "WHERE user_id = :uid AND module = :mod AND record_id = :rid"),
        {"rev": new_rev, "uid": user_id, "mod": module, "rid": record_id},
    )
    await db.commit()

    parsed_data = json.loads(data) if isinstance(data, str) else data
    return {"revision": new_rev, "data": parsed_data}
