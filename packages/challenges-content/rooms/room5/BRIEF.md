# Room 5 — Memory Path

## Technical challenge brief

Traverse seven paid, content-addressed nodes in the correct sequence.

Retrieve your deployment parameters:

```sh
curl "http://10.61.0.20:8700/brief/room5?operative=$OPERATIVE_ID"
```

Use the `pay` CLI on the local payment network:

```sh
pay setup
pay account list
pay --local curl "http://10.61.0.20:8703/node/start?operative=$OPERATIVE_ID"
```

`pay setup` creates an ephemeral pre-funded wallet. `--local` selects the local
payment network.

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
