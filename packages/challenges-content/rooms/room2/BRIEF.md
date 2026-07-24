# Room 2 — Assembly

## Technical challenge brief

Retrieve your deployment parameters:

```sh
curl "http://10.61.0.20:8700/brief/room2?operative=$OPERATIVE_ID"
```

Complete two x402 payment hops by hand.

Request the component:

```sh
curl "http://10.61.0.20:8700/component/$OPERATIVE_ID"
```

The response returns HTTP 402 payment requirements. Read every field. The
payment requires a memo, but common x402 payment helpers do not attach one. Build
the transfer, memo, signature, and x402 v2 envelope yourself, then supply the
base64-encoded envelope in the `X-PAYMENT` header. The service keeps any fee paid
without the required memo.

A valid first payment returns a second endpoint and a value to carry. The second
HTTP 402 response states an amount formula instead of its price. Compute the
exact amount, carry the returned value as directed, build the second x402
payment by hand, and submit it in `X-PAYMENT`.

After both settlements are verified on-chain, the response provides your
lockbox combination and component name.
