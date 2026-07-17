# Inference zone

This zone builds a CPU-only, Zen 5-native llama.cpp and runs `llama-server` on port 8080. Model files live under the persistent `/models` mount, while the active GGUF path is recorded in `/models/ACTIVE_MODEL`. The Hugging Face `hf` CLI is installed system-wide with pipx.

To swap quantization, edit `SB_MODEL_QUANT` (and `SB_MODEL_HF_REPO` or `SB_MODEL_ALIAS` when appropriate) in `/etc/speedbuild.env`, then rerun:

```bash
bash /opt/zone/setup.sh
```

The configured Q2 quant is the conservative default. The host's 1.15 TB of system RAM fits Q4_K_XL, which is recommended when model quality matters more than the extra memory and load time.

Expect roughly 8–15 tokens/second for a single stream on the AMD EPYC CPU. Per-stream throughput degrades as concurrent requests increase, so benchmark the intended parallel load before the event.

Admins can inspect both llama.cpp health and slot state with:

```bash
llama-health
```
