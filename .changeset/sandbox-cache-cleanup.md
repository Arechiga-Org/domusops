---
"@domusops/sandbox": patch
---

A cache of the virtual-device integration that cannot be changed (read-only, locked) no longer stops a start with a raw file-system error. A cached copy that fails its check is downloaded and checked again, and the cache is left as it is.
