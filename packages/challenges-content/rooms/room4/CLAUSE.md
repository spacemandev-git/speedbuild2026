# CLAUSE IV — NERVE
## The Burned Wing — administered by THE ACTUARY

*"Structural failure. Assessed. The estate thanks you for your carelessness."*

One wing of the estate burned the night the Founder died. Somewhere past the ruined floor sits
the registry that accepts **bearer deeds** — title to the estate's real property. A deed is
worthless until presented *in person* at the far terminal. The Founder did not believe in remote
signatures for real property.

## The terms of satisfaction

Parameters of record (either terminal):

```sh
curl "http://10.61.0.20:8700/clause/room4?claim=$CLAIM_NUMBER"
```

**At the near terminal — mint your deed.**

1. Your holdings are on record with the registry:
   `holdingsPda = findProgramAddress(["holdings", utf8($CLAIM_NUMBER)], programId)`.
   Read the record. The estate's courtesy survey of the bytes:
   ```
   offset  0..8   (seal — disregard)
   offset  8..40  registrar_key   (32 bytes — the registrar must witness the minting)
   offset  40     deeds_minted    (1 byte)
   ```
2. Call `mint_deed` on the registry with your claim number and a memorandum hash:
   `memo_hash = sha256( utf8($CLAIM_NUMBER) || utf8(attempt_salt) )` — the `attempt_salt` is in
   your parameters. The instruction requires, in the same transaction: the registrar's key among
   the accounts you pass — it is not a signer; read it from the holdings bytes — and an SPL Memo
   instruction carrying the lowercase hex of `memo_hash`. The registry rejects unwitnessed,
   unmemorialized mints. It does not say why.
3. Your deed PDA at `["deed", utf8($CLAIM_NUMBER)]` now holds an 8-character `deed_code`.
   Write it on your hand. It is not a secret — it is a *reference*. It cannot be forged, and it
   cannot be presented twice.

**The crossing.** The floor is priced. The Actuary is watching the meter.

**At the far terminal — present.** Type the code. Send
`POST http://10.61.0.20:8700/deed/present` with
`{"claim":"<your claim number>","code":"<8 chars>"}`. The far terminal reads the chain itself:
code, claim, freshness, and whether the deed has already been presented. One crossing. One deed.

— THE ACTUARY
*Contact with collapsed flooring. Assessed. Proceed.*
