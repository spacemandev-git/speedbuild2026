# Room 3 — Trust

## Technical challenge brief

A master key is split into six shares. Four shares are valid; the two invalid
shares use the same format as the valid shares.

Retrieve your deployment parameters:

```sh
curl "http://10.61.0.20:8700/brief/room3?operative=$OPERATIVE_ID"
```

Request your encrypted share:

```sh
curl "http://10.61.0.20:8700/fragment/$OPERATIVE_ID"
```

The HTTP 402 response offers two payment routes: broker settlement and raw
self-settlement with presentation of the settled signature. Broker FAC-A is
flagged `integrity unverified`. Settle the transfer yourself and verify it
on-chain rather than trusting the broker.

The response supplies key material in the `X-PAYMENT-RESPONSE` header as
base64-encoded JSON. Recover the share:

```
share = encShare XOR sha256(keyMaterial || salt)
```

Verify the trailing CRC byte. Submit `(shareIndex, share)` to the reconstruction
console named in the parameters.

After all six shares are submitted, select four distinct shares and submit a
reconstruction vote. The group has three attempts. Each failed attempt incurs a
penalty charged against the prize clock. The broker service settlement log is
displayed after the process ends, regardless of outcome.
