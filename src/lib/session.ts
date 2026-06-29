import type { FlowerSpecies, FlowerStage } from "@/types/garden";
import { readingStatusToStage } from "@/types/garden";
import type { ReadingStatus } from "@/lib/supabase/types";

export interface StoredReading {
  readingId: string;
  sessionToken: string;
  species: FlowerSpecies;
  stage: FlowerStage;
  status: ReadingStatus;
  spreadType: "single" | "three";
  xNorm: number;
  yNorm: number;
  lean: number;
  scale: number;
  createdAt: number;
}

const STORAGE_KEY = "il_readings";
const SEEKER_KEY = "il_seeker";
const SPECIES: FlowerSpecies[] = ["iris", "rose", "moonflower", "lavender", "poppy"];

export interface SeekerIdentity {
  seekerId: string;
  gardenCode?: string;
}

export function getSeeker(): SeekerIdentity | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(SEEKER_KEY);
    return raw ? (JSON.parse(raw) as SeekerIdentity) : null;
  } catch {
    return null;
  }
}

export function setSeeker(seekerId: string, gardenCode?: string): void {
  if (typeof window === "undefined") return;
  const existing = getSeeker();
  // Keep an already-known gardenCode if this call doesn't carry one.
  const next: SeekerIdentity = { seekerId, gardenCode: gardenCode ?? existing?.gardenCode };
  localStorage.setItem(SEEKER_KEY, JSON.stringify(next));
}

function hash(str: string): number {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = (Math.imul(31, h) + str.charCodeAt(i)) >>> 0;
  }
  return h;
}

export function getStoredReadings(): StoredReading[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]") as StoredReading[];
  } catch {
    return [];
  }
}

export function storeReading(
  readingId: string,
  sessionToken: string,
  spreadType: "single" | "three" = "three",
  species?: FlowerSpecies,
): StoredReading {
  const existing = getStoredReadings();
  const prior = existing.find((r) => r.readingId === readingId);
  if (prior) return prior;
  const isFirst = existing.length === 0;
  const h = hash(readingId);

  const resolvedSpecies: FlowerSpecies =
    species ?? (isFirst ? "iris" : SPECIES[1 + (h % (SPECIES.length - 1))]);

  const reading: StoredReading = {
    readingId,
    sessionToken,
    species: resolvedSpecies,
    stage: "bud",
    status: "pending_payment",
    spreadType,
    xNorm: 0.1 + ((h >>> 8) & 0xffff) / 0xffff * 0.8,
    yNorm: 0.2 + ((h >>> 16) & 0xffff) / 0xffff * 0.6,
    lean: ((h % 200) - 100) / 1000,
    scale: 0.85 + (h % 30) / 100,
    createdAt: Date.now(),
  };

  localStorage.setItem(STORAGE_KEY, JSON.stringify([...existing, reading]));
  return reading;
}

export function updateReadingStatus(
  readingId: string,
  status: ReadingStatus,
  stage: FlowerStage,
): void {
  const readings = getStoredReadings();
  const r = readings.find((x) => x.readingId === readingId);
  if (!r) return;
  r.status = status;
  r.stage = stage;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(readings));
}

export function removeReading(readingId: string): void {
  const readings = getStoredReadings().filter((r) => r.readingId !== readingId);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(readings));
}

// Rebuild localStorage from a restore_garden response. Merges with any existing
// readings (existing entries keep their species/layout); new ones get a
// deterministic species + layout from the reading id hash.
export function restoreGarden(
  readings: Array<{
    readingId: string;
    sessionToken: string;
    status: ReadingStatus;
    spreadType: "single" | "three";
    createdAt: number;
  }>,
): void {
  if (typeof window === "undefined") return;
  const existing = getStoredReadings();
  const byId = new Map(existing.map((r) => [r.readingId, r]));

  for (const r of readings) {
    const h = hash(r.readingId);
    const prior = byId.get(r.readingId);
    const species: FlowerSpecies =
      prior?.species ?? (byId.size === 0 ? "iris" : SPECIES[1 + (h % (SPECIES.length - 1))]);
    byId.set(r.readingId, {
      readingId: r.readingId,
      sessionToken: r.sessionToken,
      species,
      stage: readingStatusToStage(r.status),
      status: r.status,
      spreadType: r.spreadType,
      xNorm: 0.1 + ((h >>> 8) & 0xffff) / 0xffff * 0.8,
      yNorm: 0.2 + ((h >>> 16) & 0xffff) / 0xffff * 0.6,
      lean: ((h % 200) - 100) / 1000,
      scale: 0.85 + (h % 30) / 100,
      createdAt: r.createdAt,
    });
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify([...byId.values()]));
}
