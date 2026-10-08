"""Companion of the DomusOps sandbox harness.

Installed only into throwaway instances the harness creates. It identifies the instance to the
library, stops it when its lifetime is over, and (in later parts of this file) controls its clock.
It opens no network connections and reads nothing outside /config.
"""

from __future__ import annotations

import asyncio
from datetime import datetime, timezone
import logging
import os
from typing import Any

import voluptuous as vol

from homeassistant.components import websocket_api
from homeassistant.const import EVENT_HOMEASSISTANT_STOP
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.typing import ConfigType

DOMAIN = "domusops_sandbox"

CONFIG_SCHEMA = vol.Schema({DOMAIN: vol.Schema({})}, extra=vol.ALLOW_EXTRA)

_LOGGER = logging.getLogger(__name__)

# Seconds an owner connection may stay closed (without `detach`) before the instance stops.
OWNER_GRACE_SECONDS = 15
# Seconds a tied instance waits for its owner's first `attach`; the host sets it from its own
# readiness limit, since the owner can only attach once the host has finished waiting.
DEFAULT_FIRST_ATTACH_SECONDS = 300


def _first_attach_seconds() -> float:
    try:
        return max(1.0, float(os.environ["DOMUSOPS_SANDBOX_ATTACH_SECONDS"]))
    except (KeyError, ValueError):
        return float(DEFAULT_FIRST_ATTACH_SECONDS)


class _Lifetime:
    """Stops the instance on its deadline or when its owner goes away.

    Timers use the event loop's own clock, never the instance's time helpers, so controlling the
    instance's time cannot postpone a stop.
    """

    def __init__(self, hass: HomeAssistant) -> None:
        self.hass = hass
        self.mode = os.environ.get("DOMUSOPS_SANDBOX_MODE", "")
        self.owner: Any = None
        self.detached = False
        self.stopping = False
        self._deadline_timer: asyncio.TimerHandle | None = None
        self._first_attach_timer: asyncio.TimerHandle | None = None
        self._grace_timer: asyncio.TimerHandle | None = None

    @callback
    def start(self) -> None:
        deadline = os.environ.get("DOMUSOPS_SANDBOX_DEADLINE", "")
        try:
            at = datetime.fromisoformat(deadline.replace("Z", "+00:00"))
            if at.tzinfo is None:
                at = at.replace(tzinfo=timezone.utc)
            delay = max(0.0, (at - datetime.now(timezone.utc)).total_seconds())
            self._deadline_timer = self.hass.loop.call_later(
                delay, self.stop, "deadline reached"
            )
        except ValueError:
            _LOGGER.error("DOMUSOPS_SANDBOX_DEADLINE is not a timestamp; no deadline set")
        if self.mode == "tied":
            self._first_attach_timer = self.hass.loop.call_later(
                _first_attach_seconds(), self.stop, "no owner attached"
            )

    @callback
    def stop(self, reason: str) -> None:
        if self.stopping:
            return
        self.stopping = True
        _LOGGER.warning("Stopping the sandbox: %s", reason)
        self.hass.async_create_task(self.hass.async_stop())

    @callback
    def cancel_timers(self, _event: Any = None) -> None:
        for timer in (self._deadline_timer, self._first_attach_timer, self._grace_timer):
            if timer is not None:
                timer.cancel()
        self._deadline_timer = self._first_attach_timer = self._grace_timer = None

    @callback
    def attach(self, connection: Any, msg_id: int) -> None:
        if self._first_attach_timer is not None:
            self._first_attach_timer.cancel()
            self._first_attach_timer = None
        if self._grace_timer is not None:
            self._grace_timer.cancel()
            self._grace_timer = None
        self.owner = connection
        self.detached = False
        if self.mode != "tied":
            return

        @callback
        def closed() -> None:
            if self.owner is not connection:
                return
            self.owner = None
            if not self.detached and not self.stopping:
                self._grace_timer = self.hass.loop.call_later(
                    OWNER_GRACE_SECONDS, self.stop, "owner connection lost"
                )

        # The connection runs every subscription's unsubscribe when it closes, however it closes.
        connection.subscriptions[msg_id] = closed

    @callback
    def detach(self, connection: Any) -> None:
        if self.owner is connection:
            self.detached = True


async def async_setup(hass: HomeAssistant, config: ConfigType) -> bool:
    """Register the WebSocket commands and arm the lifetime timers."""
    lifetime = _Lifetime(hass)
    hass.data[DOMAIN] = lifetime
    websocket_api.async_register_command(hass, ws_info)
    websocket_api.async_register_command(hass, ws_attach)
    websocket_api.async_register_command(hass, ws_detach)
    hass.bus.async_listen_once(EVENT_HOMEASSISTANT_STOP, lifetime.cancel_timers)
    lifetime.start()
    return True


@websocket_api.require_admin
@websocket_api.websocket_command({vol.Required("type"): f"{DOMAIN}/info"})
@callback
def ws_info(hass: HomeAssistant, connection, msg) -> None:
    """Tell the library which sandbox this is."""
    connection.send_result(
        msg["id"],
        {
            "id": os.environ.get("DOMUSOPS_SANDBOX_ID", ""),
            "mode": os.environ.get("DOMUSOPS_SANDBOX_MODE", ""),
            "deadline": os.environ.get("DOMUSOPS_SANDBOX_DEADLINE", ""),
            "frozen": False,
        },
    )


@websocket_api.require_admin
@websocket_api.websocket_command({vol.Required("type"): f"{DOMAIN}/attach"})
@callback
def ws_attach(hass: HomeAssistant, connection, msg) -> None:
    """Make this connection the owner: if it closes without `detach`, the instance stops."""
    hass.data[DOMAIN].attach(connection, msg["id"])
    connection.send_result(msg["id"], {})


@websocket_api.require_admin
@websocket_api.websocket_command({vol.Required("type"): f"{DOMAIN}/detach"})
@callback
def ws_detach(hass: HomeAssistant, connection, msg) -> None:
    """Let the owner close its connection without stopping the instance."""
    hass.data[DOMAIN].detach(connection)
    connection.send_result(msg["id"], {})
