"""
配置分层：通过 APP_ENV 环境变量选择 test / development / production。
所有敏感值从环境变量读取，不硬编码。
"""

import os
from functools import lru_cache
from pydantic_settings import BaseSettings


class BaseConfig(BaseSettings):
    """所有环境共享的基础配置"""
    APP_ENV: str = "development"

    # JWT
    JWT_SECRET: str = "CHANGE_ME_IN_PRODUCTION"
    JWT_ALGORITHM: str = "HS256"

    # Database
    DB_HOST: str = "127.0.0.1"
    DB_PORT: int = 3306
    DB_USER: str = "uma_user"
    DB_PASSWORD: str = ""
    DB_NAME: str = "umafic"

    # Admin
    ADMIN_KEY: str = "CHANGE_ME"

    # CORS
    CORS_ORIGINS: list[str] = [
        "https://umaficstudio.com",
        "http://localhost:8080",
    ]

    SYNC_ENABLED: bool = True
    # Sync
    QUOTA_BYTES: int = 50 * 1024 * 1024  # 50MB
    MAX_PUSH_BATCH: int = 100
    MAX_RECORD_BYTES: int = 500 * 1024  # 500KB per record
    MAX_PUSH_REQUEST_BYTES: int = 50_000_000  # 50MB（十进制），含完整 JSON payload
    MAX_HTTP_BODY_BYTES: int = 51_000_000  # 在解析JSON前拒绝异常大请求
    SNAPSHOT_TTL_MINUTES: int = 30
    SNAPSHOT_PAGE_SIZE: int = 500
    SNAPSHOT_MAX_ACTIVE_PER_USER: int = 3
    CHANGELOG_RETENTION_DAYS: int = 180

    # Offline maintenance（不由 API 或应用启动自动执行）
    MAINTENANCE_ENABLED: bool = False
    TOMBSTONE_PAYLOAD_RETENTION_DAYS: int = 7
    MAINTENANCE_BATCH_SIZE: int = 500

    # Rate Limiting
    RATE_REGISTER_PER_HOUR: int = 5
    RATE_LOGIN_PER_MINUTE: int = 10
    RATE_PUSH_PER_MINUTE: int = 60
    RATE_PULL_PER_MINUTE: int = 120
    RATE_SNAPSHOT_PER_MINUTE: int = 20
    RATE_TRASH_PER_MINUTE: int = 60
    RATE_RESTORE_PER_MINUTE: int = 30
    RATE_EXPORT_PER_HOUR: int = 10
    RATE_ADMIN_PER_MINUTE: int = 5

    @property
    def database_url(self) -> str:
        return (
            f"mysql+aiomysql://{self.DB_USER}:{self.DB_PASSWORD}"
            f"@{self.DB_HOST}:{self.DB_PORT}/{self.DB_NAME}"
            "?charset=utf8mb4"
        )

    model_config = {
        "env_file": ".env",
        "env_file_encoding": "utf-8",
    }


class TestConfig(BaseConfig):
    """测试环境：使用独立数据库，放宽限流"""
    APP_ENV: str = "test"
    DB_NAME: str = "umafic_test"
    RATE_REGISTER_PER_HOUR: int = 1000
    RATE_LOGIN_PER_MINUTE: int = 1000
    RATE_PUSH_PER_MINUTE: int = 1000
    RATE_PULL_PER_MINUTE: int = 1000
    RATE_SNAPSHOT_PER_MINUTE: int = 1000
    RATE_TRASH_PER_MINUTE: int = 1000
    RATE_RESTORE_PER_MINUTE: int = 1000
    RATE_EXPORT_PER_HOUR: int = 1000
    RATE_ADMIN_PER_MINUTE: int = 1000


class DevelopmentConfig(BaseConfig):
    """开发环境"""
    APP_ENV: str = "development"


class ProductionConfig(BaseConfig):
    """生产环境：强制要求密钥已修改"""
    APP_ENV: str = "production"

    def __init__(self, **kwargs):
        super().__init__(**kwargs)
        if self.JWT_SECRET == "CHANGE_ME_IN_PRODUCTION":
            raise ValueError("JWT_SECRET must be set in production")
        if self.ADMIN_KEY == "CHANGE_ME":
            raise ValueError("ADMIN_KEY must be set in production")


_configs = {
    "test": TestConfig,
    "development": DevelopmentConfig,
    "production": ProductionConfig,
}


@lru_cache
def get_config() -> BaseConfig:
    env = os.getenv("APP_ENV", "development")
    config_class = _configs.get(env, DevelopmentConfig)
    return config_class()
