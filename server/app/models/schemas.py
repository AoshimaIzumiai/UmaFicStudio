"""
Pydantic 请求/响应 Schema。
"""

import re
import unicodedata
from datetime import datetime

from pydantic import BaseModel, Field, field_validator, model_validator

# --- 通用 ---

SYNCABLE_MODULES = frozenset([
    "horses", "dam_groups", "races", "results",
    "farms", "trainers", "owners", "countries", "jockeys",
])

USERNAME_PATTERN = re.compile(r"^[\w\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff]{2,20}$")
RECORD_ID_PATTERN = re.compile(r"^[a-zA-Z0-9_-]{1,64}$")
OP_ID_PATTERN = re.compile(r"^[a-zA-Z0-9_-]{1,64}$")


class ErrorResponse(BaseModel):
    code: str
    message: str
    details: dict | None = None
    request_id: str


# --- Auth ---

def validate_password_strength(value: str) -> str:
    """所有设置新密码的入口共用同一强度规则。"""
    if not re.search(r"[a-zA-Z]", value):
        raise ValueError("密码必须包含至少一个字母")
    if not re.search(r"[0-9]", value):
        raise ValueError("密码必须包含至少一个数字")
    return value


class RegisterRequest(BaseModel):
    username: str = Field(min_length=2, max_length=20)
    password: str = Field(min_length=6, max_length=64)

    @field_validator("username", mode="before")
    @classmethod
    def normalize_username(cls, value):
        if not isinstance(value, str):
            return value
        return unicodedata.normalize("NFC", value.strip())

    @field_validator("username")
    @classmethod
    def validate_username(cls, v: str) -> str:
        if not USERNAME_PATTERN.match(v):
            raise ValueError("用户名只允许中日文、字母、数字和下划线（2~20字符）")
        return v

    @field_validator("password")
    @classmethod
    def validate_password(cls, v: str) -> str:
        return validate_password_strength(v)


class LoginRequest(BaseModel):
    username: str
    password: str


class AuthResponse(BaseModel):
    token: str
    user: dict  # { id, username }


class ChangePasswordRequest(BaseModel):
    old_password: str
    new_password: str = Field(min_length=6, max_length=64)

    @field_validator("new_password")
    @classmethod
    def validate_new_password(cls, v: str) -> str:
        return validate_password_strength(v)


class ChangePasswordResponse(BaseModel):
    success: bool = True
    new_token: str
    request_id: str


class DeleteAccountRequest(BaseModel):
    confirm_username: str


# --- Sync ---

class PushChange(BaseModel):
    op_id: str = Field(max_length=64)
    id: str = Field(max_length=64)
    action: str  # "upsert" | "delete"
    data: dict | None = None
    known_revision: int | None = None
    local_updated_at: int | None = None

    @field_validator("op_id")
    @classmethod
    def validate_op_id(cls, v: str) -> str:
        if not OP_ID_PATTERN.match(v):
            raise ValueError("op_id 格式无效")
        return v

    @field_validator("id")
    @classmethod
    def validate_id(cls, v: str) -> str:
        if not RECORD_ID_PATTERN.match(v):
            raise ValueError("record id 格式无效")
        return v

    @field_validator("action")
    @classmethod
    def validate_action(cls, v: str) -> str:
        if v not in ("upsert", "delete"):
            raise ValueError("action 必须为 upsert 或 delete")
        return v

    @model_validator(mode="after")
    def validate_action_data(self):
        if self.action == "upsert" and self.data is None:
            raise ValueError("upsert 必须包含 data object")
        if self.action == "delete" and self.data is not None:
            raise ValueError("delete 不得包含 data")
        return self


class PushRequest(BaseModel):
    module: str
    changes: list[PushChange] = Field(min_length=1, max_length=100)

    @field_validator("module")
    @classmethod
    def validate_module(cls, v: str) -> str:
        if v not in SYNCABLE_MODULES:
            raise ValueError(f"无效模块: {v}")
        return v


class PushResult(BaseModel):
    op_id: str
    status: str  # "accepted" | "duplicate" | "deleted_conflict"
    revision: int | None = None
    id: str | None = None
    delete_revision: int | None = None


class PushResponse(BaseModel):
    results: list[PushResult]
    request_id: str


class PullResponse(BaseModel):
    changes: list[dict]
    next_cursor: int
    has_more: bool
    min_available_revision: int
    reset_required: bool
    request_id: str


class SnapshotRequest(BaseModel):
    snapshot_token: str | None = Field(default=None, min_length=20, max_length=128)
    cursor: int | None = Field(default=None, ge=-1)

    @model_validator(mode="after")
    def validate_continuation(self):
        if self.cursor is not None and not self.snapshot_token:
            raise ValueError("cursor 只能与 snapshot_token 一起使用")
        return self


class SnapshotResponse(BaseModel):
    snapshot_token: str
    snapshot_revision: int
    total_items: int
    items: list[dict]
    next_cursor: int | None
    has_more: bool
    request_id: str


class StatusResponse(BaseModel):
    modules: dict
    active_size_bytes: int
    total_size_bytes: int
    quota_bytes: int
    current_revision: int
    request_id: str


class RestoreRequest(BaseModel):
    module: str
    id: str
    base_delete_revision: int

    @field_validator("module")
    @classmethod
    def validate_module(cls, v: str) -> str:
        if v not in SYNCABLE_MODULES:
            raise ValueError(f"无效模块: {v}")
        return v

    @field_validator("id")
    @classmethod
    def validate_id(cls, v: str) -> str:
        if not RECORD_ID_PATTERN.match(v):
            raise ValueError("record id 格式无效")
        return v


# --- Admin ---

class AdminResetPasswordRequest(BaseModel):
    username: str
    new_password: str = Field(min_length=6, max_length=64)

    @field_validator("new_password")
    @classmethod
    def validate_new_password(cls, v: str) -> str:
        return validate_password_strength(v)
