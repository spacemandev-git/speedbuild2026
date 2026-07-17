# challenges-content

In-fiction challenge briefs pushed to participants on admin "reveal" (see docs/ARCHITECTURE.md §10).
`rooms/<room>/` is copied verbatim to `/home/claimant/estate/rooms/<room>/` in the participant
container by host-agent.

Conventions:
- Briefs are written in the will's voice (see docs/Estate.md). They never say "coding exercise".
- Deployment-specific values (program ID, SCRIP mint, exact endpoints) are NEVER hardcoded here.
  Every brief points to the clause endpoint:
  `curl http://10.61.0.20:8700/clause/<room>?claim=$CLAIM_NUMBER`
  which returns live params as JSON. (`$CLAIM_NUMBER` is set in the participant's environment.)
- Hints are NOT in these files — timed hints/codicils are delivered via the executor feed.
