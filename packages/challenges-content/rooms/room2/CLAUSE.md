# CLAUSE II — COMPETENCE
## The Vault Wing — administered by THE AUDITOR

*"The estate does not hand hardware to heirs who cannot use the tools."*

The Founder's last machine was disassembled and locked, component by component, behind the
Auditor's paywalls. The will is explicit: pay correctly, or pay for nothing. The Auditor will
happily keep a fee and give you nothing, because the will says competence, not effort.

## The terms of satisfaction

Parameters of record:

```sh
curl "http://10.61.0.20:8700/clause/room2?claim=$CLAIM_NUMBER"
```

**First — the sealed component.**

```sh
curl "http://10.61.0.20:8700/component/$CLAIM_NUMBER"
```

You will be told payment is required, and how. Read what you are told — *all* of what you are
told. The estate notes, as a matter of probate record, that the popular conveniences for paying
such demands do not attach memoranda, and the estate requires a memorandum. A fee received
without authorization is merely a fee received. The estate keeps fees.

Those who wish to be given things must construct their payment themselves: the transfer, the
memorandum beside it, the signature, the envelope — presented in the `X-PAYMENT` header as the
demand describes.

**Second — the authorization.** Satisfaction of the first demand discloses a second clause and a
value to carry. The second demand does not state its price. It states a *formula*. The estate
believes an heir should be able to compute what it owes. Pay the exact computed amount to the
named recipient, carrying what you were given.

**Third.** When both settlements stand on-chain, the vault yields: your lockbox combination and
the name of your component. Bring it to the assembly table. The machine remembers how to speak.

— THE AUDITOR
*Fee received. Authorization absent. The estate keeps the fee.*
