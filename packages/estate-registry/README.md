# Estate Registry

`estate_registry` is the Anchor program behind Rooms 1 and 4 of The Estate. In Room 1 it exposes
the probate record that contestants hand-decode before paying their exact SCRIP tribute. In Room 4
it mints a short-lived bearer deed whose eight-character code can be carried across the physical
gauntlet and presented once at the far terminal.

## Layout guarantees

The account discriminator occupies bytes `0..8`. The following offsets are a public challenge
contract and must not move:

| Account | Bytes after discriminator |
| --- | --- |
| `ClaimRecord` | executor `8..40`; status `40`; probate nonce `41..49` little-endian; tribute ATA `49..81` |
| `TeamHoldings` | registrar key `8..40`; deeds minted `40` |

`ClaimRecord` and `TeamHoldings` intentionally contain no `String` fields. Claim numbers and team
names are instruction arguments used as PDA seeds only. `Deed.team` is a Borsh string capped at 16
UTF-8 bytes and remains the first deed field.

The PDAs are:

- config: `["config"]`
- claim: `["claim", lowercase(claim_number)]`
- team holdings: `["team", team_name]`
- deed: `["deed", team_name]`

## Build and test

The workspace is pinned to the Rust version emitted by Anchor CLI 1.1.2.

```sh
npm install
npm run build
npm test
```

`anchor test` starts a local validator, deploys the program, and runs the Mocha TypeScript suite.
The tests assert the Room 1 raw byte offsets, authority gates, memo and registrar requirements,
fresh and stale deed presentation, and the one-shot presentation rule.

Production should initialize `deed_window_slots` to `4500`. The authority-only
`set_deed_window` instruction exists to exercise staleness deterministically in local tests.
