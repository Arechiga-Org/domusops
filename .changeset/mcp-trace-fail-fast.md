---
"@domusops/mcp": patch
---

`ha_trace` now fails fast and never leaves a request hanging. After one trace read fails, no further trace read starts. Closing the connection ends every command still waiting with a "connection closed" error instead of leaving it unsettled. Reads that do not depend on each other run together, so a request waits for its longest chain of dependent reads instead of the sum of all of them. At `detail=standard`, a result that cannot fit the size limit is refused as soon as the runs read so far already exceed it, instead of after every stored trace has been read; the refusal then says "would be N bytes or more". A result that fits is unchanged.
