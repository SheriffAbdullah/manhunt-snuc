# scripts

## `load-test.mjs`

Simulates many phones against a running sync server from one IP address (the shape of campus Wi-Fi behind NAT). Each player joins, polls every 5 s, pings every 30 s; hunters catch runners at a steady rate; one abusive player bursts 60 events to confirm the per-player 429 limit does not touch anyone else.

```
node scripts/load-test.mjs --api http://localhost:8084 --players 300 --seconds 60
```

Prints p50/p95/p99 latency per method, the status histogram and the final server counts. Exit code 1 if any 5xx or network error happened, a catch went missing, or the abusive player was not throttled. Deterministic (seeded PRNG; `--seed` to change). Creates one throwaway game, which the server purges 24 h after it ends.

Do not run it against the production server while a real game is on.
