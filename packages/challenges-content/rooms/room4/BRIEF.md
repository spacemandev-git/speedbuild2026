# Room 4 — Minesweeper

## Technical challenge brief

Retrieve your deployment parameters from either terminal:

```sh
curl "http://10.61.0.20:8700/brief/room4?operative=$OPERATIVE_ID"
```

Derive and read your holdings account:

```
holdingsPda = findProgramAddress(
  ["holdings", utf8(operative id verbatim)],
  programId
)
```

No schemas are published; decode the account from this byte survey:

```
offset  0..8   (account discriminator — disregard)
offset  8..40  registrar_key   (32 bytes — required witness account)
offset  40     codes_minted    (1 byte)
```

Call `mint_code` with your operative ID and this hash:

```
memo_hash = sha256(utf8(operative id) || utf8(attempt_salt))
```

`attempt_salt` is provided in the parameters. In the same transaction, include:

- the account at `registrar_key` among the instruction accounts; it is not a
  signer;
- an SPL Memo instruction containing lowercase hexadecimal `memo_hash`.

The registry rejects minting without either requirement and does not state
which requirement failed.

The record at the following PDA contains an 8-character `clearance_code`:

```
codePda = findProgramAddress(
  ["deed", utf8(operative id)],
  programId
)
```

The code is a non-secret reference that cannot be forged. Present it within its
freshness window; it can be presented only once:

```http
POST http://10.61.0.20:8700/code/present
Content-Type: application/json

{"operative": "<id>", "code": "<8 chars>"}
```

The presentation service reads the chain and verifies the code, operative ID,
freshness, and presentation status.
