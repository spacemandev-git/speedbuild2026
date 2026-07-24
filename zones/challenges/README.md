# Challenges zone

This directory is installed at `/opt/zone` in the Ubuntu 24.04 `challenges`
Incus container. It runs the private Surfpool Solana network and deploys the
SCRIP mint plus `estate_registry`; the separately pushed executor API serves the
challenge HTTP surfaces.

Setup installs the pinned Anchor CLI 1.1.2 directly from its Git tag with
`cargo install --locked`; AVM is not used in this container.

## Services

- `surfpool.service` — local Solana RPC on `0.0.0.0:8899` and WebSocket on
  `0.0.0.0:8900`, persisted beneath `/var/lib/surfpool`.
- `executor-api.service` — Bun API from `/opt/packages/executor-api`; it is
  enabled during setup and started only after deployment succeeds.

Inspect them with `systemctl status surfpool executor-api` and follow logs with
`journalctl -u surfpool -u executor-api -f`.

## Deploy or re-run

All deploy steps are idempotent and run in numeric order:

```bash
sudo /opt/zone/run-deploy.sh
```

To use a non-default claimant registry:

```bash
sudo /opt/zone/run-deploy.sh /var/lib/estate/my-claimants.json
```

The host-agent normally creates or updates `/var/lib/estate/claimants.json` and
re-runs the seed step. Its format is:

```json
{
  "claimants": [
    { "claimNumber": "CLAIMANT-01", "pubkey": "<base58 public key>" }
  ]
}
```

After the host-agent adds entries, either re-run the full command above or only:

```bash
cd /opt/zone/deploy
set -a; source /etc/speedbuild.env; set +a
bun run src/30-fund-and-seed.ts /var/lib/estate/claimants.json
```

## SPL dumps

Surfpool runs offline. Before that first offline start, use an internet-connected
container to run `cd /opt/zone/deploy && bun run src/dump-spl.ts`. This obtains
the Token, Associated Token, and Memo program dumps from mainnet-beta. Binary
`.so` files are intentionally excluded from this repository.

## Surfpool cheatcodes for operators

Cheatcodes are ordinary JSON-RPC calls. For example, set an owner's SCRIP token
account to one token (SCRIP has six decimals):

```bash
curl -sS http://127.0.0.1:8899 -H 'content-type: application/json' -d '{
  "jsonrpc":"2.0","id":1,"method":"surfnet_setTokenAccount",
  "params":["OWNER_PUBKEY","SCRIP_MINT",{"amount":1000000},"TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"]
}' | jq
```

Advance the surfnet clock to an absolute slot:

```bash
curl -sS http://127.0.0.1:8899 -H 'content-type: application/json' -d '{
  "jsonrpc":"2.0","id":1,"method":"surfnet_timeTravel",
  "params":[{"absoluteSlot":123456789}]
}' | jq
```

Cheatcodes bypass normal chain rules. Restrict RPC access to the competition
network and use these only for provisioning or recovery.
