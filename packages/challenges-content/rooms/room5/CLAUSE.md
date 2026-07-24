# CLAUSE V — DILIGENCE
## The Ledger Room — administered by THE ACTUARY

*"The Founder moved its fortune along a private routing sequence. The executors have scattered
the route."*

Seven paid waypoints through the Founder's ledger. Each node reveals the next only after it is
paid — and the Tempter has salted the ledger with decoys: plausible, purchasable, poisoned.
Reconstruct the route cleanly and the estate will show you the path through the ledger vault —
briefly. The cleaner your reconstruction, the longer the Founder lets you look.

## The terms of satisfaction

Parameters of record:

```sh
curl "http://10.61.0.20:8700/clause/room5?claim=$CLAIM_NUMBER"
```

**The tool.** The estate honors the `pay` instrument on its private rails:

```sh
pay setup            # an ephemeral wallet; the estate has already provided for it
pay account list
pay --local curl "http://10.61.0.20:8703/node/start?claim=$CLAIM_NUMBER"
```

(`--local` binds the instrument to the estate's rails rather than the public ones. The estate's
rails are the only rails that matter tonight.)

The parameters include your `startUrl`; it carries `?claim=$CLAIM_NUMBER`. Preserve that claim
query on every request, including `.../node/<id>?claim=$CLAIM_NUMBER`.

**The traversal.** Each paid node on your route answers with its position, the *name of the next
node*, and a line of the Founder's own guidance. Nodes are named, not numbered — `/node/1` does
not exist, and the estate finds the assumption insulting. Two positions on the route carry a
decoy: paying it returns `{"corrupted": true}`, ends your clean streak, wastes a hop, and is
priced against the pot. The guidance line disambiguates. Read it. Decide.

Seven hops. A loop, a parse, a judgment call. The Founder wrote this route by hand; you may
automate your walk of it.

**The mercy.** The final node scores your reconstruction and files it with the operator:

```
flash_seconds = 3 + hops_correct   (bounded 3..10)
```

Clean route, long look. Corrupt route, short look. No route — you start blind.

— THE ACTUARY
*Wasted payment. Itemised. The pot notices.*
