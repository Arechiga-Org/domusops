"""Clock control for the sandbox harness (research R6).

A frozen instance reports one fixed instant from Home Assistant's time helpers. `advance` moves
that instant forward and runs the timers of `homeassistant.helpers.event` (time triggers, time
patterns, delays, intervals) that fall due on the way, in order, the way Home Assistant's own test
helper does. Timers of anything else on the event loop (connections, the lifetime deadline) are
left on real time, so controlling the clock cannot break the harness.

This relies on Home Assistant internals (`helpers.event.time_tracker_*`, the loop's timer heap).
Those are covered by the container tests that run against every supported release.
"""

from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone
import heapq
import logging
from typing import Any

from homeassistant.core import HomeAssistant
from homeassistant.helpers import event as ha_event
from homeassistant.util import dt as dt_util

_LOGGER = logging.getLogger(__name__)

MAX_ADVANCE_SECONDS = 7 * 24 * 3600
# Upper bound on the timers one `advance` runs, so a runaway interval cannot hang the instance.
MAX_FIRED = 100_000
_EVENT_MODULE = ha_event.__name__


class ClockError(Exception):
    """A clock command that cannot be carried out; `code` is the WebSocket error code."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code


def _is_event_timer(handle: Any) -> bool:
    callback = getattr(handle, "_callback", None)
    module = getattr(callback, "__module__", None) or type(callback).__module__
    return module == _EVENT_MODULE


def format_time(value: datetime) -> str:
    return value.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def parse_time(value: str) -> datetime:
    parsed = dt_util.parse_datetime(value)
    if parsed is None:
        raise ClockError("invalid_time", f"{value!r} is not an ISO 8601 date and time.")
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=dt_util.DEFAULT_TIME_ZONE)
    return parsed.astimezone(timezone.utc)


class Clock:
    def __init__(self, hass: HomeAssistant) -> None:
        self.hass = hass
        self._now: datetime | None = None
        self._original: dict[str, Any] | None = None
        self._lock = asyncio.Lock()

    @property
    def frozen(self) -> bool:
        return self._now is not None

    def now(self) -> datetime:
        return self._now if self._now is not None else dt_util.utcnow()

    def _utcnow(self) -> datetime:
        assert self._now is not None
        return self._now

    def _local_now(self, time_zone: Any = None) -> datetime:
        assert self._now is not None
        return self._now.astimezone(time_zone or dt_util.DEFAULT_TIME_ZONE)

    def _timestamp(self) -> float:
        assert self._now is not None
        return self._now.timestamp()

    def _install(self) -> None:
        if self._original is not None:
            return
        self._original = {
            "utcnow": dt_util.utcnow,
            "now": dt_util.now,
            "tracker_utcnow": ha_event.time_tracker_utcnow,
            "tracker_timestamp": ha_event.time_tracker_timestamp,
        }
        dt_util.utcnow = self._utcnow
        dt_util.now = self._local_now
        ha_event.time_tracker_utcnow = self._utcnow
        ha_event.time_tracker_timestamp = self._timestamp

    def _restore(self) -> None:
        original = self._original
        if original is None:
            return
        dt_util.utcnow = original["utcnow"]
        dt_util.now = original["now"]
        ha_event.time_tracker_utcnow = original["tracker_utcnow"]
        ha_event.time_tracker_timestamp = original["tracker_timestamp"]
        self._original = None

    async def _rearm(self) -> None:
        """Timers registered before the clock changed are aimed at the old time; register them again.

        Automations are switched off and on rather than reloaded, because a reload keeps every
        automation whose configuration did not change, together with its old timers.
        """
        if not self.hass.services.has_service("automation", "turn_off"):
            return
        enabled = [
            state.entity_id
            for state in self.hass.states.async_all("automation")
            if state.state == "on"
        ]
        if not enabled:
            return
        try:
            await self.hass.services.async_call(
                "automation",
                "turn_off",
                {"entity_id": enabled, "stop_actions": False},
                blocking=True,
            )
            await self.hass.services.async_call(
                "automation", "turn_on", {"entity_id": enabled}, blocking=True
            )
        except Exception:  # noqa: BLE001 - best effort; the command itself still succeeded
            _LOGGER.warning("Could not re-arm automations after a clock change", exc_info=True)

    async def freeze(self, at: datetime, *, rearm: bool = True) -> datetime:
        async with self._lock:
            return await self._freeze(at, rearm=rearm)

    async def _freeze(self, at: datetime, *, rearm: bool = True) -> datetime:
        self._now = at
        self._install()
        if rearm:
            await self._rearm()
        return at

    async def resume(self) -> datetime:
        async with self._lock:
            was_frozen = self.frozen
            self._restore()
            self._now = None
            if was_frozen:
                await self._rearm()
            return dt_util.utcnow()

    async def advance(self, seconds: float) -> tuple[datetime, int]:
        if not 0 < seconds <= MAX_ADVANCE_SECONDS:
            raise ClockError(
                "invalid_time",
                f"`seconds` must be greater than 0 and at most {MAX_ADVANCE_SECONDS}.",
            )
        async with self._lock:
            return await self._advance(seconds)

    async def _advance(self, seconds: float) -> tuple[datetime, int]:
        if self._now is None:
            # Freezing at the real time leaves the pending timers correctly aimed.
            await self._freeze(dt_util.utcnow(), rearm=False)
        assert self._now is not None
        loop = self.hass.loop
        target = self._now + timedelta(seconds=seconds)
        target_ts = target.timestamp()
        start_ts = self._now.timestamp()
        fired = 0
        sequence = 0
        # (due, order, handle): the timers of the event helper, earliest first.
        queue: list[tuple[float, int, Any]] = []

        def track(handle: Any) -> None:
            nonlocal sequence
            if handle.cancelled() or not _is_event_timer(handle):
                return
            assert self._now is not None
            expected = getattr(handle._callback, "expected_fire_timestamp", None)
            due = (
                float(expected)
                if expected is not None
                else self._now.timestamp() + max(0.0, handle.when() - loop.time())
            )
            sequence += 1
            heapq.heappush(queue, (due, sequence, handle))

        for handle in list(loop._scheduled):  # type: ignore[attr-defined]
            track(handle)

        # Timers scheduled while the advance runs are picked up here, without scanning the loop.
        original_call_at = loop.call_at

        def call_at(when: float, callback: Any, *args: Any, **kwargs: Any) -> Any:
            handle = original_call_at(when, callback, *args, **kwargs)
            track(handle)
            return handle

        loop.call_at = call_at  # type: ignore[method-assign]
        try:
            while queue:
                due, _, handle = queue[0]
                if handle.cancelled():
                    heapq.heappop(queue)
                    continue
                # A timer already overdue when the advance starts belongs to the real clock (a
                # token expiry in the past of the frozen time, say) and re-arms itself for the
                # same instant.
                if due <= start_ts:
                    heapq.heappop(queue)
                    continue
                if due > target_ts:
                    break
                heapq.heappop(queue)
                fired += 1
                if fired > MAX_FIRED:
                    raise ClockError(
                        "time_control_failed",
                        f"More than {MAX_FIRED} timers fell due while advancing; stopped at "
                        f"{format_time(self._now)}.",
                    )
                # A timer rearms itself when it runs even a hair early, so the clock must not
                # fall short of the instant through rounding to microseconds.
                instant = datetime.fromtimestamp(due, timezone.utc)
                while instant.timestamp() < due:
                    instant += timedelta(microseconds=1)
                self._now = max(self._now, instant)
                handle._run()
                handle.cancel()
                await asyncio.sleep(0)
            self._now = max(self._now, target)
        finally:
            del loop.call_at
            # Timers that did not fall due keep their remaining virtual time on the real clock;
            # after a failure that is measured from where the clock stopped.
            assert self._now is not None
            now_ts = self._now.timestamp()
            loop_now = loop.time()
            for due, _, handle in queue:
                if handle.cancelled():
                    continue
                if getattr(handle._callback, "expected_fire_timestamp", None) is None:
                    handle._when = loop_now + max(0.0, due - now_ts)
            heapq.heapify(loop._scheduled)  # type: ignore[attr-defined]
        return self._now, fired
