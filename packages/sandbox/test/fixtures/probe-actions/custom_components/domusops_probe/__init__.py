"""Test-only probe for specs/006-scenario-dsl research R6.

Wraps `ServiceRegistry.async_call` at class level, the way the companion's absent-action command
will, and reports what the script engine does when it meets an action the instance does not
offer. It is copied into an instance only by `scenario-facts.container.test.ts`.
"""

from __future__ import annotations

from homeassistant.core import HomeAssistant, ServiceRegistry
from homeassistant.exceptions import ServiceNotFound

DOMAIN = "domusops_probe"

# Calls to this domain are answered (not failed), like a declared absent action.
ANSWERED_DOMAIN = "absent_ok"


async def async_setup(hass: HomeAssistant, config: dict) -> bool:
    original = ServiceRegistry.async_call

    async def wrapped(self, domain, service, *args, **kwargs):
        try:
            return await original(self, domain, service, *args, **kwargs)
        except ServiceNotFound:
            hass.bus.async_fire(
                "domusops_probe_missing",
                {"domain": domain, "service": service, "answered": domain == ANSWERED_DOMAIN},
            )
            if domain == ANSWERED_DOMAIN:
                return None
            raise

    ServiceRegistry.async_call = wrapped
    return True
