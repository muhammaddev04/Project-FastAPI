from __future__ import annotations

import time
from collections import defaultdict


class InMemoryRateLimiter:
    def __init__(self, limit: int = 5, window_seconds: int = 900):
        self.limit = limit
        self.window_seconds = window_seconds
        self._store: dict[str, list[float]] = defaultdict(list)

    def check(self, key: str) -> bool:
        now = time.time()
        window = self._store[key]
        window[:] = [ts for ts in window if now - ts < self.window_seconds]
        if len(window) >= self.limit:
            return False
        window.append(now)
        return True


rate_limiter = InMemoryRateLimiter(limit=5, window_seconds=900)
