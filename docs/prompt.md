We're going to be running the Speedbuild competition on a "Sunburst" machine.

We need to set up this repo as a set of scripts and code packages that'll bootstrap a fresh sunburst machine running ubuntu with everything we need to run this competition all through a single entrypoint.

It'll have three VM style isloations: inference, challenges, participant accounts.

I'll need an admin dashboard that lets me provision participant accounts, as well as downloads and sets up a solana developement environment needed for all the challenges in @Estate.md for each participant.

Participants should be able to SSH into their account, and start trying out challenges availalble to them, with admin opening / revealing new challenges to them to explore. It should also screen record everything a participant is doing while SSH'd in and live stream and record it to the admin dashboard.

We also want to provide AI inference via API to each of these participant accounts, so they should have OpenCode installed and configured with our inference endpoint with provided models. On the inference sandbox on the sunburst machine we probably want to run GLM 5.2 q2 by Unsloth.

It should also have all the challenges built out and deployed to a live solana surfpool instance and monitorable by the admin dashboard.

Ask clarifying questions and try to accomplish as much in parallel as possible.
