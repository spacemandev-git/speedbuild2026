# Speedbuild

Speedbuild bootstraps the Speed Build 2026 “Estate” competition on the Ubuntu 24.04 bare-metal Sunburst server. It creates isolated Incus zones for administration, challenges, inference, and participant environments.

Sunburst is sized around a 64-core/128-thread AMD EPYC 9555P, 1.15 TB RAM, and 6.4 TB NVMe. See [the hardware notes](docs/sunburst.md) and the authoritative [architecture contract](docs/ARCHITECTURE.md).

Copying the example configuration happens automatically on the first run. Before bootstrap can continue, fill the three generated secrets in `config/speedbuild.env` as instructed there, then rerun:

```bash
sudo ./bootstrap.sh
```

For a small two-participant pipeline test, set `SB_SMOKE_TEST=1` in `config/speedbuild.env`. This uses the tiny model and reduced zone limits while preserving the full bootstrap flow.
