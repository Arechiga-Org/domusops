---
"@domusops/sandbox": minor
---

First release of `@domusops/sandbox`, the ephemeral Home Assistant harness. `start` runs a throwaway instance in a container at a resolved release channel (stable, previous stable or beta) or an exact release, completes onboarding through the instance's own HTTP API, and hands back a loopback address and a per-instance admin token. `stop`, `list` and `cleanup` manage instances; every instance is labelled, stops itself at a deadline or when its owning process dies, and nothing outside the labelled set is ever touched. `resolve` prints the release behind a channel.
