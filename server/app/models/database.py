"""
SQLAlchemy ORM 模型，映射数据库表结构。
"""

from datetime import datetime

from sqlalchemy import (
    BigInteger, DateTime, ForeignKey, Index, Integer, JSON, SmallInteger,
    String, Text, UniqueConstraint,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    pass


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    username: Mapped[str] = mapped_column(String(60), unique=True, nullable=False)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    token_version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=datetime.utcnow)
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class SyncData(Base):
    """当前状态表：每条记录的最新版本"""
    __tablename__ = "sync_data"
    __table_args__ = (
        UniqueConstraint("user_id", "module", "record_id", name="uk_user_module_record"),
        Index("idx_user_revision", "user_id", "revision"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    module: Mapped[str] = mapped_column(String(20), nullable=False)
    record_id: Mapped[str] = mapped_column(String(64), nullable=False)
    data: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    revision: Mapped[int] = mapped_column(BigInteger, nullable=False)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    is_tombstone: Mapped[int] = mapped_column(SmallInteger, nullable=False, default=0)


class SyncChange(Base):
    """变更日志：cursor 分页的数据源"""
    __tablename__ = "sync_changes"
    __table_args__ = (
        UniqueConstraint("user_id", "op_id", name="uk_user_opid"),
        Index("idx_changes_user_revision", "user_id", "revision"),
    )

    revision: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    module: Mapped[str] = mapped_column(String(20), nullable=False)
    record_id: Mapped[str] = mapped_column(String(64), nullable=False)
    action: Mapped[str] = mapped_column(String(10), nullable=False)
    data: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    op_id: Mapped[str] = mapped_column(String(64), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=datetime.utcnow)


class SyncRetentionState(Base):
    """已清理 changelog 的持久低水位，防止旧 cursor 静默漏数据。"""
    __tablename__ = "sync_retention_state"

    user_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    min_available_revision: Mapped[int] = mapped_column(
        BigInteger, nullable=False, default=0
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, default=datetime.utcnow
    )


class SyncSnapshot(Base):
    """物化快照元数据"""
    __tablename__ = "sync_snapshots"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    snapshot_revision: Mapped[int] = mapped_column(BigInteger, nullable=False)
    total_items: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    expires_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=datetime.utcnow)


class SyncSnapshotItem(Base):
    """物化快照数据行"""
    __tablename__ = "sync_snapshot_items"
    __table_args__ = (
        Index("idx_snapshot_sort", "snapshot_id", "sort_key"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    snapshot_id: Mapped[int] = mapped_column(Integer, ForeignKey("sync_snapshots.id", ondelete="CASCADE"), nullable=False)
    module: Mapped[str] = mapped_column(String(20), nullable=False)
    record_id: Mapped[str] = mapped_column(String(64), nullable=False)
    data: Mapped[dict] = mapped_column(JSON, nullable=False)
    revision: Mapped[int] = mapped_column(BigInteger, nullable=False)
    sort_key: Mapped[int] = mapped_column(Integer, nullable=False)
