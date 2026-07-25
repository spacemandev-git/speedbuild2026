# Speedbuild

Speedbuild bootstraps the Speed Build 2026 Bureau environment on the Ubuntu 24.04 bare-metal
Sunburst server. It creates isolated Incus zones for administration, challenges, and participant
boxes; deploys `packages/bureau-registry` and `packages/bureau-api`; and provides the operator
dashboard and recording services.

Sunburst is sized for a 64-core/128-thread AMD EPYC 9555P, 1.15 TB RAM, and 6.4 TB NVMe. See the
[hardware notes](docs/sunburst.md), [technical brief](docs/TECH_BRIEF.md), and authoritative
[architecture contract](docs/ARCHITECTURE.md).

The first run copies `config/speedbuild.env.example` to `config/speedbuild.env` and stops until
the required `SB_BUREAU_SECRET`, `SB_ADMIN_TOKEN`, and `SB_HOST_AGENT_TOKEN` values are set.
Then rerun:

```bash
sudo ./bootstrap.sh
```

For a two-participant pipeline test, set `SB_SMOKE_TEST=1`. This uses reduced zone limits while
preserving the complete bootstrap flow.
