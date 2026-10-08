# @domusops/sandbox

Ephemeral test harness for Home Assistant. It starts a throwaway instance in a container at a
chosen release (current stable, previous stable, or current beta), ready with a known admin token
and no manual onboarding, and tears it down cleanly, even after a crash.

- **Docker is the only hard runtime dependency.** Podman works through `DOMUSOPS_CONTAINER=podman`.
- **It never touches a real instance.** The library accepts no URL and no token. Every operation
  works on an instance this package created and labelled itself.
- Home Assistant is a trademark of its owner; this project is independent and is not affiliated
  with or endorsed by it.

Usage, the CLI reference and the supported-versions table are added as the feature lands.
