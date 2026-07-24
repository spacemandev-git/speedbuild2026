# Room 1 — Operation

## Technical challenge brief

Retrieve your deployment parameters:

```sh
curl "http://10.61.0.20:8700/brief/room1?operative=$OPERATIVE_ID"
```

The response provides the operative ID as `operativeId`, registry program, RPC
endpoint, CRED mint as `credMint`, and clearance nonce as `clearanceNonce`. No
schemas are published; decode the account from the byte survey below.

Derive and read your verification record:

```
recordPda = findProgramAddress(
  ["claim", utf8(lowercase(operative id))],
  programId
)
```

```
offset  0..8   (account discriminator — disregard)
offset  8..40  verifier          (32 bytes)
offset  40     status            (1 byte: 0 UNVERIFIED, 1 VERIFIED)
offset  41..49 clearance_nonce   (8 bytes, little-endian)
offset  49..81 clearance_ata     (32 bytes — payment destination)
```

Send the exact amount of CRED in base units to `clearance_ata` with the exact SPL
Memo:

```
amount = 1000 + (clearance_nonce mod 9000)
memo   = sha256(utf8(operative id) || nonce as 8 LE bytes).hex[:16]
```

The transfer and memo must be in the same transaction. The verification service
checks both and does not provide rejection details.

When the record status becomes `VERIFIED`, the console displays
`VERIFIED — UNLOCK RELEASED` and provides the briefcase combination.
