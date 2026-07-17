# Participant zone

This directory defines the software baked into the `p-template` Incus container.
Its contents run inside Ubuntu 24.04, not on the Speedbuild host.
The setup installs participant toolchains, CLIs, SSH, and recording support.
It creates the unprivileged `claimant` account and its initial workspace.
`rec-shell` records interactive SSH sessions and passes commands through.
`opencode.json.template` configures the Estate inference endpoint.
`setup.sh` reads competition values from `/etc/speedbuild.env`.
The host script `host/30-participant-template.sh` launches `p-template`.
That script pushes this directory into the container at `/opt/zone`.
It then invokes `bash /opt/zone/setup.sh` as root inside the container.
Setup is idempotent and may be rerun while rebuilding the golden image.
Participant instances are copied from the stopped template afterward.
Do not run this zone setup directly on the competition host.
