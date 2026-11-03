"""安全离线维护入口：python -m app.maintenance [--execute]。"""

import argparse
import asyncio
import json
import sys
from collections.abc import Awaitable, Callable

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.config import BaseConfig, get_config
from app.services.maintenance_service import (
    CleanupResult,
    cleanup_changelog,
    cleanup_expired_snapshots,
    cleanup_tombstone_payloads,
)

CleanupCall = Callable[..., Awaitable[CleanupResult]]


class MaintenanceSafetyError(RuntimeError):
    """可安全直接显示、且在连接数据库前产生的配置错误。"""


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="UmaFicStudio offline data maintenance")
    parser.add_argument(
        "--execute",
        action="store_true",
        help="执行写入；省略时只统计符合条件的数据",
    )
    parser.add_argument(
        "--batch-size",
        type=int,
        default=None,
        help="每批最大行数；默认读取 MAINTENANCE_BATCH_SIZE",
    )
    return parser


def _ensure_execution_allowed(config: BaseConfig, execute: bool) -> None:
    if execute and not config.MAINTENANCE_ENABLED:
        raise MaintenanceSafetyError(
            "写入被拒绝：必须同时设置 MAINTENANCE_ENABLED=true 并传入 --execute"
        )


async def _run_in_batches(
    cleanup: CleanupCall,
    db: AsyncSession,
    *,
    execute: bool,
    batch_size: int,
    **kwargs,
) -> dict:
    first = await cleanup(
        db,
        execute=execute,
        batch_size=batch_size,
        **kwargs,
    )
    total_affected = first.affected
    latest = first
    while execute and latest.affected == batch_size:
        latest = await cleanup(
            db,
            execute=True,
            batch_size=batch_size,
            **kwargs,
        )
        total_affected += latest.affected

    return {
        "eligible": first.eligible,
        "affected": total_affected,
        "dry_run": not execute,
    }


async def run_maintenance(args: argparse.Namespace) -> dict:
    config = get_config()
    _ensure_execution_allowed(config, args.execute)
    batch_size = (
        config.MAINTENANCE_BATCH_SIZE
        if args.batch_size is None
        else args.batch_size
    )
    if batch_size < 1:
        raise MaintenanceSafetyError("batch_size must be at least 1")

    engine = create_async_engine(
        config.database_url,
        pool_size=1,
        max_overflow=0,
        pool_recycle=3600,
    )
    session_factory = async_sessionmaker(engine, expire_on_commit=False)
    try:
        async with session_factory() as db:
            tombstones = await _run_in_batches(
                cleanup_tombstone_payloads,
                db,
                execute=args.execute,
                batch_size=batch_size,
                retention_days=config.TOMBSTONE_PAYLOAD_RETENTION_DAYS,
            )
            snapshots = await _run_in_batches(
                cleanup_expired_snapshots,
                db,
                execute=args.execute,
                batch_size=batch_size,
            )
            changelog = await _run_in_batches(
                cleanup_changelog,
                db,
                execute=args.execute,
                batch_size=batch_size,
                retention_days=config.CHANGELOG_RETENTION_DAYS,
            )
    finally:
        await engine.dispose()

    return {
        "mode": "execute" if args.execute else "dry-run",
        "tombstone_payloads": tombstones,
        "expired_snapshots": snapshots,
        "changelog": changelog,
    }


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        result = asyncio.run(run_maintenance(args))
    except Exception as exc:
        # 数据库异常可能包含连接信息或SQL参数，只回显明确的本地安全检查消息。
        message = (
            str(exc)
            if isinstance(exc, MaintenanceSafetyError)
            else "maintenance failed; inspect protected server logs"
        )
        print(json.dumps({
            "status": "error",
            "error_type": type(exc).__name__,
            "message": message,
        }, ensure_ascii=False), file=sys.stderr)
        return 1

    print(json.dumps({"status": "ok", **result}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
