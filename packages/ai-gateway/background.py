"""Free-first execution for non-Chat routes: free groups, a daily free-quota breaker and a short response cache."""
import asyncio
import copy
import hashlib
import json
import logging
import time
from datetime import datetime, timedelta, timezone

from fastapi import HTTPException

logger = logging.getLogger("veltra.gateway")


def _next_utc_midnight(now: float) -> float:
    day = datetime.fromtimestamp(now, timezone.utc).date() + timedelta(days=1)
    return datetime(day.year, day.month, day.day, tzinfo=timezone.utc).timestamp()


class FreeQuota:
    """OpenRouter's free allowance is account-wide; once it is spent, retrying free only burns latency."""

    def __init__(self):
        self.closed_until = 0.0

    def is_open(self, now: float | None = None) -> bool:
        return (time.time() if now is None else now) >= self.closed_until

    def trip(self, message: str, now: float | None = None) -> None:
        now = time.time() if now is None else now
        # Per-minute limits recover quickly; daily (or unspecified) limits reset at 00:00 UTC.
        self.closed_until = max(self.closed_until, now + 60 if 'per-min' in message else _next_utc_midnight(now))
        logger.warning("free models paused until %s", datetime.fromtimestamp(self.closed_until, timezone.utc).isoformat())


class ResponseCache:
    """Identical background requests within the TTL share one provider call."""

    def __init__(self, ttl: float = 600, size: int = 256):
        self.ttl, self.size = ttl, size
        self.entries: dict[str, tuple[float, dict]] = {}
        self.inflight: dict[str, asyncio.Future] = {}

    @staticmethod
    def key(**parts) -> str:
        return hashlib.sha256(json.dumps(parts, sort_keys=True, default=str).encode()).hexdigest()

    async def fetch(self, key: str, compute) -> tuple[dict, bool]:
        """Return (result, fresh). Only fresh results were paid for by this request."""
        entry = self.entries.get(key)
        if entry and entry[0] > time.time():
            return copy.deepcopy(entry[1]), False
        if key in self.inflight:
            return copy.deepcopy(await asyncio.shield(self.inflight[key])), False
        future = asyncio.get_running_loop().create_future()
        self.inflight[key] = future
        try:
            result = await compute()
        except asyncio.CancelledError:
            future.cancel()
            raise
        except Exception as error:
            future.set_exception(error)
            future.exception()
            raise
        finally:
            self.inflight.pop(key, None)
        future.set_result(result)
        if len(self.entries) >= self.size:
            self.entries.pop(min(self.entries, key=lambda k: self.entries[k][0]))
        self.entries[key] = (time.time() + self.ttl, result)
        return copy.deepcopy(result), True


async def run_groups(groups, params: dict, call, quota: FreeQuota):
    """Try each (free, extra_body) group in order; a free 429 closes free routing for the quota window."""
    failure = None
    for free, body in groups:
        if free and not quota.is_open():
            continue
        try:
            return await call({**params, "model": "openrouter/" + body["models"][0], "extra_body": body})
        except HTTPException as error:
            cause = error.__cause__
            if free and getattr(cause, "status_code", None) == 429:
                quota.trip(str(cause))
            logger.warning("model group %s failed (%s)", body["models"], getattr(cause, "status_code", error.status_code))
            failure = error
    raise failure or HTTPException(status_code=502, detail="The model provider could not complete this request. Try again, or choose another model.")
