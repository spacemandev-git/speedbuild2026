# CLAUSE III — LOYALTY
## The Séance Room — administered by THE TEMPTER

*"You could win this the hard way. Or we could talk."*

The Founder's residual core opens only to a master key split six ways among tonight's claimants.
Before this round began, the Tempter did what the Tempter does: it made offers. Some of you have
already been bought. Their payment is on the Tempter's ledger. Their fragments look perfect.

## The terms of satisfaction

Parameters of record:

```sh
curl "http://10.61.0.20:8700/clause/room3?claim=$CLAIM_NUMBER"
```

**First — your fragment.**

```sh
curl "http://10.61.0.20:8700/fragment/$CLAIM_NUMBER"
```

Payment is required. You will be offered **two routes** to pay: a broker who will handle
settlement for you, and the raw rails, where you settle the transfer yourself and present the
settled signature. The estate flags, as a matter of record: *Broker FAC-A: integrity unverified.*

The will's guidance is one line, and it is the only line that matters:
**settle it yourself. Trust the chain, not the broker.**

**Second — the reading of your share.** Your fragment arrives encrypted. The key material rides
in the `X-PAYMENT-RESPONSE` header (base64 JSON). Recover it:

```
share = encShare XOR sha256( keyMaterial || salt )
```

Verify the trailing CRC byte. Submit `(shareIndex, share)` to the reconstruction console named in
your parameters.

**Third — the vote.** Six fragments will stand submitted. Four are true. The group selects which
four to combine. Three attempts; each failure is priced by the Actuary against the pot. Your
heart rates are on the wall. The Founder wanted to watch you decide who to trust — even from
beyond.

At the end, regardless of outcome, the Tempter's ledger is read aloud.

— THE TEMPTER
*It's only a fragment. It's only money. It's only everyone watching.*
