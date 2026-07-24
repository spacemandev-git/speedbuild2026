# Bureau Registry

`bureau_registry` is an Anchor program that stores operative verification data and issues
short-lived clearance codes. Verification status is authority-controlled. Code issuance requires
the configured registrar account and an exact memo instruction; presentation is authority-gated,
time-limited, and one-shot.

## Layout guarantees

The account discriminator occupies bytes `0..8`. The following offsets are a public challenge
contract and must not move:

| Account | Bytes after discriminator |
| --- | --- |
| `VerificationRecord` | verifier `8..40`; status `40`; clearance nonce `41..49` little-endian; clearance ATA `49..81` |
| `OperativeHoldings` | registrar key `8..40`; codes minted `40` |

`VerificationRecord` and `OperativeHoldings` intentionally contain no `String` fields. Operative
IDs are instruction arguments used as PDA seeds only. `ClearanceRecord.operative` is a Borsh
string capped at 16 UTF-8 bytes and remains the first clearance-record field.

The PDAs are:

- config: `["config"]`
- verification record: `["claim", lowercase(operative_id)]`
- operative holdings: `["holdings", operative_id]`
- clearance record: `["deed", operative_id]`

## Build and test

The workspace is pinned to the Rust version emitted by Anchor CLI 1.1.2.

```sh
npm install
npm run build
npm test
```

`anchor test` starts a local validator, deploys the program, and runs the Mocha TypeScript suite.
The tests assert raw byte offsets, authority gates, memo and registrar requirements, code-window
validation, and the one-shot presentation rule.

Production should initialize `code_window_slots` to `4500`. The authority-only
`set_code_window` instruction supports deterministic window validation in local tests.
