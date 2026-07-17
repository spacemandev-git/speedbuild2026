#!/usr/bin/env bun
/**
 * Generate an image via OpenRouter (google/gemini-3.1-flash-lite-image).
 *
 * Usage:
 *   bun scripts/generate-image.ts "<prompt>" <output-path>
 *   bun scripts/generate-image.ts "a red dragon token, top-down, flat colors" rulesets/foo/assets/dragon.png
 *
 * Requires OPENROUTER_KEY in .env (Bun auto-loads .env from the repo root).
 * Output format is inferred from the returned data URL; the file is written
 * to <output-path> regardless of extension, so match the extension yourself.
 */

const MODEL = "google/gemini-3.1-flash-lite-image";

const [prompt, outPath] = Bun.argv.slice(2);
if (!prompt || !outPath) {
  console.error(
    'Usage: bun scripts/generate-image.ts "<prompt>" <output-path>',
  );
  process.exit(1);
}

const key = process.env.OPENROUTER_KEY;
if (!key) {
  console.error("OPENROUTER_KEY is not set (expected in .env at repo root).");
  process.exit(1);
}

const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
  method: "POST",
  headers: {
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    model: MODEL,
    messages: [{ role: "user", content: prompt }],
    modalities: ["image", "text"],
  }),
});

if (!res.ok) {
  console.error(`OpenRouter request failed: ${res.status} ${res.statusText}`);
  console.error(await res.text());
  process.exit(1);
}

const body = (await res.json()) as {
  error?: { message?: string };
  choices?: Array<{
    message?: {
      content?: string;
      images?: Array<{ image_url?: { url?: string } }>;
    };
  }>;
};

if (body.error) {
  console.error(
    `OpenRouter error: ${body.error.message ?? JSON.stringify(body.error)}`,
  );
  process.exit(1);
}

const message = body.choices?.[0]?.message;
const dataUrl = message?.images?.[0]?.image_url?.url;
if (!dataUrl) {
  console.error("No image in response. Model text output:");
  console.error(message?.content ?? JSON.stringify(body, null, 2));
  process.exit(1);
}

const match = dataUrl.match(/^data:(image\/[\w+.-]+);base64,(.+)$/s);
if (!match) {
  console.error(`Unexpected image URL format: ${dataUrl.slice(0, 80)}...`);
  process.exit(1);
}

const [, mime, b64] = match;
await Bun.write(outPath, Buffer.from(b64, "base64"));
console.log(
  `Wrote ${outPath} (${mime}, ${Buffer.from(b64, "base64").byteLength} bytes)`,
);
