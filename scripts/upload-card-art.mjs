/**
 * Downloads card art from krates98/tarotcardapi GitHub raw URLs
 * and uploads each image to the Supabase `card-art` bucket.
 * Then updates `cards.image_path` in the DB to match.
 *
 * Usage: node scripts/upload-card-art.mjs
 * Requires NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local
 */

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dir = dirname(fileURLToPath(import.meta.url));

// Load .env.local manually
const envPath = join(__dir, "../.env.local");
const env = Object.fromEntries(
  readFileSync(envPath, "utf8")
    .split("\n")
    .filter((l) => l.includes("=") && !l.startsWith("#"))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    })
);

const SUPABASE_URL = env["NEXT_PUBLIC_SUPABASE_URL"];
const SERVICE_ROLE_KEY = env["SUPABASE_SERVICE_ROLE_KEY"];
const GITHUB_RAW = "https://raw.githubusercontent.com/krates98/tarotcardapi/main/images";

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// Mapping: card id → GitHub image filename (case-sensitive, matches repo)
const CARD_IMAGES = [
  // Major Arcana (0–21)
  { id: 0,  file: "thefool.jpeg" },
  { id: 1,  file: "themagician.jpeg" },
  { id: 2,  file: "thehighpriestess.jpeg" },
  { id: 3,  file: "theempress.jpeg" },
  { id: 4,  file: "theemperor.jpeg" },
  { id: 5,  file: "thehierophant.jpeg" },
  { id: 6,  file: "TheLovers.jpg" },
  { id: 7,  file: "thechariot.jpeg" },
  { id: 8,  file: "thestrength.jpeg" },
  { id: 9,  file: "thehermit.jpeg" },
  { id: 10, file: "wheeloffortune.jpeg" },
  { id: 11, file: "justice.jpeg" },
  { id: 12, file: "thehangedman.jpeg" },
  { id: 13, file: "death.jpeg" },
  { id: 14, file: "temperance.jpeg" },
  { id: 15, file: "thedevil.jpeg" },
  { id: 16, file: "thetower.jpeg" },
  { id: 17, file: "thestar.jpeg" },
  { id: 18, file: "themoon.jpeg" },
  { id: 19, file: "thesun.jpeg" },
  { id: 20, file: "judgement.jpeg" },
  { id: 21, file: "theworld.jpeg" },
  // Wands (22–35)
  { id: 22, file: "aceofwands.jpeg" },
  { id: 23, file: "twoofwands.jpeg" },
  { id: 24, file: "threeofwands.jpeg" },
  { id: 25, file: "fourofwands.jpeg" },
  { id: 26, file: "fiveofwands.jpeg" },
  { id: 27, file: "sixofwands.jpeg" },
  { id: 28, file: "sevenofwands.jpeg" },
  { id: 29, file: "eightofwands.jpeg" },
  { id: 30, file: "nineofwands.jpeg" },
  { id: 31, file: "tenofwands.jpeg" },
  { id: 32, file: "pageofwands.jpeg" },
  { id: 33, file: "knightofwands.jpeg" },
  { id: 34, file: "queenofwands.jpeg" },
  { id: 35, file: "kingofwands.jpeg" },
  // Cups (36–49)
  { id: 36, file: "aceofcups.jpeg" },
  { id: 37, file: "twoofcups.jpeg" },
  { id: 38, file: "threeofcups.jpeg" },
  { id: 39, file: "fourofcups.jpeg" },
  { id: 40, file: "fiveofcups.jpeg" },
  { id: 41, file: "sixofcups.jpeg" },
  { id: 42, file: "sevenofcups.jpeg" },
  { id: 43, file: "eightofcups.jpeg" },
  { id: 44, file: "nineofcups.jpeg" },
  { id: 45, file: "tenofcups.jpeg" },
  { id: 46, file: "pageofcups.jpeg" },
  { id: 47, file: "knightofcups.jpeg" },
  { id: 48, file: "queenofcups.jpeg" },
  { id: 49, file: "kingofcups.jpeg" },
  // Swords (50–63)
  { id: 50, file: "aceofswords.jpeg" },
  { id: 51, file: "twoofswords.jpeg" },
  { id: 52, file: "threeofswords.jpeg" },
  { id: 53, file: "fourofswords.jpeg" },
  { id: 54, file: "fiveofswords.jpeg" },
  { id: 55, file: "sixofswords.jpeg" },
  { id: 56, file: "sevenofswords.jpeg" },
  { id: 57, file: "eightofswords.jpeg" },
  { id: 58, file: "nineofswords.jpeg" },
  { id: 59, file: "tenofswords.jpeg" },
  { id: 60, file: "pageofswords.jpeg" },
  { id: 61, file: "knightofswords.jpeg" },
  { id: 62, file: "queenofswords.jpeg" },
  { id: 63, file: "kingofswords.jpeg" },
  // Pentacles (64–77)
  { id: 64, file: "aceofpentacles.jpeg" },
  { id: 65, file: "twoofpentacles.jpeg" },
  { id: 66, file: "threeofpentacles.jpeg" },
  { id: 67, file: "fourofpentacles.jpeg" },
  { id: 68, file: "fiveofpentacles.jpeg" },
  { id: 69, file: "sixofpentacles.jpeg" },
  { id: 70, file: "sevenofpentacles.jpeg" },
  { id: 71, file: "eightofpentacles.jpeg" },
  { id: 72, file: "nineofpentacles.jpeg" },
  { id: 73, file: "tenofpentacles.jpeg" },
  { id: 74, file: "pageofpentacles.jpeg" },
  { id: 75, file: "knightofpentacles.jpeg" },
  { id: 76, file: "queenofpentacles.jpeg" },
  { id: 77, file: "kingofpentacles.jpeg" },
];

async function uploadCard({ id, file }) {
  const url = `${GITHUB_RAW}/${file}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status}`);

  const buffer = await res.arrayBuffer();
  const contentType = file.endsWith(".jpg") || file.endsWith(".jpeg") ? "image/jpeg" : "image/png";

  const { error } = await supabase.storage
    .from("card-art")
    .upload(file, buffer, { contentType, upsert: true });

  if (error) throw new Error(`Upload failed for ${file}: ${error.message}`);

  // Update image_path in cards table
  const { error: dbErr } = await supabase
    .from("cards")
    .update({ image_path: file })
    .eq("id", id);

  if (dbErr) throw new Error(`DB update failed for id ${id}: ${dbErr.message}`);

  return file;
}

async function main() {
  console.log(`Uploading ${CARD_IMAGES.length} card images to card-art bucket…\n`);
  let ok = 0, fail = 0;

  for (const card of CARD_IMAGES) {
    try {
      const file = await uploadCard(card);
      console.log(`✓ ${String(card.id).padStart(2, " ")} ${file}`);
      ok++;
    } catch (err) {
      console.error(`✗ id=${card.id}: ${err.message}`);
      fail++;
    }
    // Small delay to avoid hammering GitHub
    await new Promise((r) => setTimeout(r, 80));
  }

  console.log(`\nDone: ${ok} uploaded, ${fail} failed.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
