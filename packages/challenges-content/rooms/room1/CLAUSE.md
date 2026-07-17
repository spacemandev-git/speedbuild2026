# CLAUSE I — PROVENANCE
## The Reading Room — administered by THE AUDITOR

*"You wish to touch the Founder's remains. First, the estate will confirm you are who the will
thinks you are."*

The Founder's five server bodies lie in state in the Reading Room. Each carries a probate implant
that opens only to a claimant who can read its state, speak its language, and send the exact
clearance signal it awaits — a verified payment on the Founder's own rails.

## The terms of satisfaction

Retrieve your parameters of record:

```sh
curl "http://10.61.0.20:8700/clause/room1?claim=$CLAIM_NUMBER"
```

This discloses: the registry program of the estate, the rails (RPC endpoint), and the currency of
the estate (`SCRIP`). Nothing else will be disclosed. The estate does not publish schemas. The
Founder considered them a crutch.

**First.** Your probate record exists. It was written before you arrived. Find it:

```
recordPda = findProgramAddress(["claim", utf8(lowercase(your claim number))], programId)
```

Read it. The estate offers one courtesy, a partial survey of the bytes:

```
offset  0..8   (the estate's seal — disregard)
offset  8..40  executor         (32 bytes)
offset  40     status           (1 byte: 0 UNPROVEN, 1 PROVEN)
offset  41..49 probate_nonce    (8 bytes, little-endian)
offset  49..81 tribute_ata      (32 bytes — where your tribute must land)
```

**Second.** Prove your claim. Send an exact tribute of `SCRIP` to the `tribute_ata` of your
record, in the exact amount, bearing the exact memorandum:

```
amount (base units)  = 1000 + (probate_nonce mod 9000)
memorandum (SPL Memo) = first 16 hex characters of
                        sha256( utf8(claim_number) || probate_nonce as 8 little-endian bytes )
```

The transfer and the memorandum must travel in the same transaction. The Auditor verifies both.
The Auditor does not explain rejections. The Auditor does not have to.

**Third.** When your record reads PROVEN, the console will speak: *CLAUSE SATISFIED — ESCROW
RELEASED*, and the combination to your sealed instrument case will be read to you. No proof, no
instruments. No instruments, no game.

— THE AUDITOR
*Claim received. Claim unverified. Verification is not free.*
