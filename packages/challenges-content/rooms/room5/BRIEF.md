# Room 5 — Memory Path

## Technical challenge brief

Traverse seven paid, content-addressed nodes in the correct sequence.

Retrieve your deployment parameters:

```sh
curl "http://10.61.0.20:8700/brief/room5?operative=$OPERATIVE_ID"
```

Use `x402-curl` to open the first paid node:

```sh
x402-curl "http://10.61.0.20:8703/node/start?operative=$OPERATIVE_ID"
```

`x402-curl` performs the 402 → pay → retry cycle automatically, signing with
your own funded keypair at `~/.config/solana/id.json`. Use
`x402-curl -v <url>` to show the advertised payment terms and settlement
signature.

The parameters include `startUrl` with `?operative=$OPERATIVE_ID`. Preserve the
`?operative=` query on every node request, including:

```text
http://10.61.0.20:8703/node/<id>?operative=$OPERATIVE_ID
```

Each paid node returns its position, the content-addressed name of the next
node, and a guidance line. Nodes are named, not sequentially numbered;
`/node/1` does not exist.

Two route positions offer a decoy. Paying a decoy returns:

```json
{"corrupted": true}
```

A decoy ends the clean streak, wastes a hop, and incurs a penalty charged
against the prize clock. Use the guidance line to distinguish the correct node.
You may automate the seven-hop traversal.

The final node scores the reconstructed route:

```
flash_seconds = 3 + hops_correct   (bounded 3..10)
```

A clean route receives the longest allocation; a corrupted route receives a
shorter allocation. Without a completed route, no allocation is provided.
