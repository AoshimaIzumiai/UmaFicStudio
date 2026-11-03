"""公网最低安全控制：单 worker 内存限流与请求分类。"""

from collections import defaultdict, deque
from dataclasses import dataclass
import time


@dataclass(frozen=True)
class RateRule:
    name: str
    limit: int
    window_seconds: int


class InMemoryRateLimiter:
    """适用于当前单 worker 部署；不存 token、用户名或请求 payload。"""

    def __init__(self, max_keys: int = 10_000):
        self._events: dict[tuple[str, str], deque[float]] = defaultdict(deque)
        self._max_keys = max_keys
        self._checks = 0

    def check(self, rule: RateRule, client_ip: str, now: float | None = None) -> tuple[bool, int]:
        now = time.monotonic() if now is None else now
        key = (rule.name, client_ip or "unknown")
        events = self._events[key]
        cutoff = now - rule.window_seconds
        while events and events[0] <= cutoff:
            events.popleft()
        if len(events) >= rule.limit:
            retry_after = max(1, int(events[0] + rule.window_seconds - now + 0.999))
            return False, retry_after
        events.append(now)

        self._checks += 1
        if self._checks % 256 == 0 or len(self._events) > self._max_keys:
            self._prune(now)
        return True, 0

    def _prune(self, now: float) -> None:
        # 所有窗口都不超过一小时；过期 key 可安全丢弃。
        stale = [key for key, events in self._events.items()
                 if not events or events[-1] <= now - 3600]
        for key in stale:
            self._events.pop(key, None)
        if len(self._events) > self._max_keys:
            oldest = sorted(self._events, key=lambda key: self._events[key][-1])
            for key in oldest[:len(self._events) - self._max_keys]:
                self._events.pop(key, None)


def get_rate_rule(method: str, path: str, config) -> RateRule | None:
    key = (method.upper(), path)
    rules = {
        ("POST", "/api/auth/register"): RateRule("register", config.RATE_REGISTER_PER_HOUR, 3600),
        ("POST", "/api/auth/login"): RateRule("login", config.RATE_LOGIN_PER_MINUTE, 60),
        ("POST", "/api/sync/push"): RateRule("push", config.RATE_PUSH_PER_MINUTE, 60),
        ("GET", "/api/sync/pull"): RateRule("pull", config.RATE_PULL_PER_MINUTE, 60),
        ("POST", "/api/sync/snapshot"): RateRule("snapshot", config.RATE_SNAPSHOT_PER_MINUTE, 60),
        ("GET", "/api/sync/trash"): RateRule("trash", config.RATE_TRASH_PER_MINUTE, 60),
        ("POST", "/api/sync/restore"): RateRule("restore", config.RATE_RESTORE_PER_MINUTE, 60),
        ("GET", "/api/sync/export"): RateRule("export", config.RATE_EXPORT_PER_HOUR, 3600),
        ("POST", "/api/admin/reset-password"): RateRule("admin", config.RATE_ADMIN_PER_MINUTE, 60),
    }
    rule = rules.get(key)
    if rule and rule.limit > 0:
        return rule
    return None


rate_limiter = InMemoryRateLimiter()
