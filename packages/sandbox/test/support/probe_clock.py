"""Runs the companion's clock probe against a stand-in `homeassistant` package, so the behaviour on
a release that lacks one of the internals time control replaces can be tested without a container.
Prints one JSON object of results."""

import sys

# The companion directory ships in the package: never leave bytecode in it.
sys.dont_write_bytecode = True

import asyncio
import importlib.util
import json
import sys
import types
from datetime import datetime, timezone


def module(name, **attributes):
    created = types.ModuleType(name)
    created.__dict__.update(attributes)
    sys.modules[name] = created
    return created


def install(missing=None, broken_import=None):
    """Registers the stand-in package; `missing` is a (module, attribute) pair to leave out and
    `broken_import` a helper module that cannot be imported."""
    for name in [n for n in sys.modules if n == "homeassistant" or n.startswith("homeassistant.")]:
        del sys.modules[name]
    pkg = module("homeassistant")
    pkg.__path__ = []
    module("homeassistant.const", __version__="2099.1.0")
    core = module("homeassistant.core", HomeAssistant=object, time=object())
    util = module("homeassistant.util")
    util.__path__ = []
    dt = module(
        "homeassistant.util.dt",
        utcnow=lambda: None,
        now=lambda: None,
        DEFAULT_TIME_ZONE=timezone.utc,
        parse_datetime=lambda value: None,
    )
    helpers = module("homeassistant.helpers")
    helpers.__path__ = []
    entity = module("homeassistant.helpers.entity", timer=lambda: 0.0)
    event = module(
        "homeassistant.helpers.event",
        time_tracker_utcnow=lambda: None,
        time_tracker_timestamp=lambda: 0.0,
    )
    script = module("homeassistant.helpers.script")
    pkg.core = core
    pkg.util = util
    util.dt = dt
    helpers.entity, helpers.event, helpers.script = entity, event, script
    if missing is not None:
        owner = {"dt": dt, "core": core, "entity": entity, "event": event}[missing[0]]
        delattr(owner, missing[1])
    if broken_import is not None:
        sys.modules[f"homeassistant.helpers.{broken_import}"] = None


def load(path):
    spec = importlib.util.spec_from_file_location("clock_under_test", path)
    clock = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(clock)
    return clock


def probe(path, **kwargs):
    install(**kwargs)
    clock = load(path)
    try:
        clock._probe()
        return {"ok": True}
    except clock.ClockError as error:
        return {"ok": False, "code": error.code, "message": str(error)}


async def freeze_leaves_clock(path):
    install(missing=("event", "time_tracker_timestamp"))
    clock = load(path)
    instance = clock.Clock(object())
    try:
        await instance.freeze(datetime(2031, 3, 4, tzinfo=timezone.utc))
    except clock.ClockError as error:
        return {"code": error.code, "frozen": instance.frozen}
    return {"code": None, "frozen": instance.frozen}


path = sys.argv[1]
print(
    json.dumps(
        {
            "complete": probe(path),
            "event": probe(path, missing=("event", "time_tracker_utcnow")),
            "entity": probe(path, missing=("entity", "timer")),
            "core": probe(path, missing=("core", "time")),
            "dt": probe(path, missing=("dt", "now")),
            "script": probe(path, broken_import="script"),
            "freeze": asyncio.run(freeze_leaves_clock(path)),
        }
    )
)
