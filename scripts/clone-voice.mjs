// Creates an ElevenLabs Instant Voice Clone from the recordings in
// voice-samples/ and prints the voice id to put in .env.
//
//   1. Record 1–3 minutes of yourself talking naturally (see voice-samples/README.md)
//   2. Put ELEVENLABS_API_KEY in .env
//   3. npm run clone-voice

import fs from "node:fs";
import path from "node:path";

const key = process.env.ELEVENLABS_API_KEY;
if (!key) {
  console.error("Set ELEVENLABS_API_KEY in .env first.");
  process.exit(1);
}

const dir = path.resolve("voice-samples");
const files = fs
  .readdirSync(dir)
  .filter((f) => /\.(mp3|wav|m4a|ogg|flac|webm)$/i.test(f))
  .map((f) => path.join(dir, f));
if (files.length === 0) {
  console.error(`No audio files found in ${dir}. Add .mp3/.wav/.m4a recordings and try again.`);
  process.exit(1);
}

const form = new FormData();
form.append("name", "Akshith (portfolio twin)");
form.append("description", "Voice clone of Satya Akshith Pakalapati for his own AI portfolio site.");
form.append("remove_background_noise", "true");
for (const f of files) form.append("files", await fs.openAsBlob(f), path.basename(f));

console.log(`Uploading ${files.length} sample(s) to ElevenLabs…`);
const res = await fetch("https://api.elevenlabs.io/v1/voices/add", {
  method: "POST",
  headers: { "xi-api-key": key },
  body: form,
});
const body = await res.json().catch(() => ({}));
if (!res.ok) {
  console.error(`ElevenLabs returned ${res.status}:`, JSON.stringify(body, null, 2));
  process.exit(1);
}

console.log("\nVoice created. Add this line to .env and restart the server:\n");
console.log(`ELEVENLABS_VOICE_ID=${body.voice_id}\n`);
if (body.requires_verification) console.log("Note: ElevenLabs says this voice requires verification — check your dashboard.");
