# challenges-content

Technical challenge briefs are pushed to participants when an administrator
reveals a room. The host agent copies `rooms/<room>/` to
`/home/operative/bureau/rooms/<room>/` in the participant container.

Deployment-specific values are never hardcoded in these files. Each brief
retrieves live values from:

```sh
curl "http://10.61.0.20:8700/brief/<room>?operative=$OPERATIVE_ID"
```

Hints are not included in the briefs. Timed hints are delivered through the
system message feed.
