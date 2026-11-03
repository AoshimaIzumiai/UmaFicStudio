"""离线数据维护服务。

可清除超过保留期的 tombstone payload、过期物化 snapshot，以及超过
180 天的 changelog。changelog 删除与 retention floor 推进位于同一事务，
确保旧 cursor 不会在日志清理后静默漏数据。
"""

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession


@dataclass(frozen=True)
class CleanupResult:
    eligible: int
    affected: int
    dry_run: bool


def _validate_positive(name: str, value: int) -> None:
    if value < 1:
        raise ValueError(f"{name} must be at least 1")


def _utc_naive(value: datetime | None = None) -> datetime:
    current = value or datetime.now(timezone.utc)
    if current.tzinfo is not None:
        current = current.astimezone(timezone.utc).replace(tzinfo=None)
    return current


async def cleanup_tombstone_payloads(
    db: AsyncSession,
    *,
    retention_days: int = 7,
    batch_size: int = 500,
    execute: bool = False,
    now: datetime | None = None,
) -> CleanupResult:
    """清空一批过期 tombstone 的 payload，同时保留 tombstone fence。"""
    _validate_positive("retention_days", retention_days)
    _validate_positive("batch_size", batch_size)
    cutoff = _utc_naive(now) - timedelta(days=retention_days)
    where_clause = (
        "is_tombstone = 1 AND data IS NOT NULL "
        "AND deleted_at IS NOT NULL AND deleted_at <= :cutoff"
    )

    count_result = await db.execute(
        text(f"SELECT COUNT(*) FROM sync_data WHERE {where_clause}"),
        {"cutoff": cutoff},
    )
    eligible = int(count_result.scalar() or 0)
    if not execute or eligible == 0:
        return CleanupResult(eligible=eligible, affected=0, dry_run=not execute)

    try:
        result = await db.execute(
            text(
                f"UPDATE sync_data SET data = NULL WHERE {where_clause} "
                "ORDER BY id LIMIT :batch_size"
            ),
            {"cutoff": cutoff, "batch_size": batch_size},
        )
        await db.commit()
    except Exception:
        await db.rollback()
        raise

    return CleanupResult(
        eligible=eligible,
        affected=max(int(result.rowcount or 0), 0),
        dry_run=False,
    )


async def cleanup_expired_snapshots(
    db: AsyncSession,
    *,
    batch_size: int = 500,
    execute: bool = False,
    now: datetime | None = None,
) -> CleanupResult:
    """删除一批过期 snapshot；其 items 由外键 ON DELETE CASCADE 清除。"""
    _validate_positive("batch_size", batch_size)
    expires_at = _utc_naive(now)
    where_clause = "expires_at <= :expires_at"

    count_result = await db.execute(
        text(f"SELECT COUNT(*) FROM sync_snapshots WHERE {where_clause}"),
        {"expires_at": expires_at},
    )
    eligible = int(count_result.scalar() or 0)
    if not execute or eligible == 0:
        return CleanupResult(eligible=eligible, affected=0, dry_run=not execute)

    try:
        result = await db.execute(
            text(
                f"DELETE FROM sync_snapshots WHERE {where_clause} "
                "ORDER BY id LIMIT :batch_size"
            ),
            {"expires_at": expires_at, "batch_size": batch_size},
        )
        await db.commit()
    except Exception:
        await db.rollback()
        raise

    return CleanupResult(
        eligible=eligible,
        affected=max(int(result.rowcount or 0), 0),
        dry_run=False,
    )


async def cleanup_changelog(
    db: AsyncSession,
    *,
    retention_days: int = 180,
    batch_size: int = 500,
    execute: bool = False,
    now: datetime | None = None,
) -> CleanupResult:
    """删除一批过期 changelog，并在同一事务推进每个用户的可靠 floor。

    加锁顺序保持为 users 行 -> sync_changes 行，与 push/restore 一致，避免
    维护任务和在线写入形成反向锁顺序。floor 取该用户本批最大删除 revision，
    表示最小安全 cursor；即使该用户所有 changelog 都被删除，旧 cursor 仍会
    触发 snapshot，而 snapshot_revision 等于 floor 时不会再次被判过期。
    """
    _validate_positive("retention_days", retention_days)
    _validate_positive("batch_size", batch_size)
    cutoff = _utc_naive(now) - timedelta(days=retention_days)

    count_result = await db.execute(
        text("SELECT COUNT(*) FROM sync_changes WHERE created_at <= :cutoff"),
        {"cutoff": cutoff},
    )
    eligible = int(count_result.scalar() or 0)
    if not execute or eligible == 0:
        return CleanupResult(eligible=eligible, affected=0, dry_run=not execute)

    try:
        preview_result = await db.execute(
            text(
                "SELECT revision, user_id FROM sync_changes "
                "WHERE created_at <= :cutoff ORDER BY revision ASC LIMIT :batch_size"
            ),
            {"cutoff": cutoff, "batch_size": batch_size},
        )
        preview_rows = preview_result.fetchall()
        user_ids = sorted({int(row[1]) for row in preview_rows})
        if not user_ids:
            await db.commit()
            return CleanupResult(eligible=eligible, affected=0, dry_run=False)

        user_placeholders = ", ".join(
            f":user_id_{index}" for index in range(len(user_ids))
        )
        user_params = {
            f"user_id_{index}": user_id
            for index, user_id in enumerate(user_ids)
        }
        await db.execute(
            text(
                "SELECT id FROM users WHERE id IN ("
                f"{user_placeholders}) ORDER BY id FOR UPDATE"
            ),
            user_params,
        )

        selected_result = await db.execute(
            text(
                "SELECT revision, user_id FROM sync_changes "
                "WHERE created_at <= :cutoff AND user_id IN ("
                f"{user_placeholders}) ORDER BY revision ASC "
                "LIMIT :batch_size FOR UPDATE"
            ),
            {**user_params, "cutoff": cutoff, "batch_size": batch_size},
        )
        selected_rows = selected_result.fetchall()
        if not selected_rows:
            await db.commit()
            return CleanupResult(eligible=eligible, affected=0, dry_run=False)

        floors: dict[int, int] = {}
        revisions = []
        for revision, user_id in selected_rows:
            revision = int(revision)
            user_id = int(user_id)
            revisions.append(revision)
            floors[user_id] = max(floors.get(user_id, 0), revision)

        updated_at = _utc_naive(now)
        for user_id, floor in floors.items():
            await db.execute(
                text(
                    "INSERT INTO sync_retention_state "
                    "(user_id, min_available_revision, updated_at) "
                    "VALUES (:uid, :floor, :updated_at) "
                    "ON DUPLICATE KEY UPDATE "
                    "min_available_revision = GREATEST(min_available_revision, :floor), "
                    "updated_at = :updated_at"
                ),
                {"uid": user_id, "floor": floor, "updated_at": updated_at},
            )

        revision_placeholders = ", ".join(
            f":revision_{index}" for index in range(len(revisions))
        )
        revision_params = {
            f"revision_{index}": revision
            for index, revision in enumerate(revisions)
        }
        deleted = await db.execute(
            text(
                "DELETE FROM sync_changes WHERE revision IN ("
                f"{revision_placeholders}) AND created_at <= :cutoff"
            ),
            {**revision_params, "cutoff": cutoff},
        )
        await db.commit()
    except Exception:
        await db.rollback()
        raise

    return CleanupResult(
        eligible=eligible,
        affected=max(int(deleted.rowcount or 0), 0),
        dry_run=False,
    )
