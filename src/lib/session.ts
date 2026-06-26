import type { FlowerSpecies, FlowerStage } from "@/types/garden";
import type { ReadingStatus } from "@/lib/supabase/types";

export interface StoredReading {
  readingId: string;
  sessionToken: string;
  recoveryCode?: string;
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
const SPECIES: FlowerSpecies[] = ["iris", "rose", "moonflower", "lavender", "poppy"];

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
  recoveryCode?: string,
): StoredReading {
  const existing = getStoredReadings();
  const isFirst = existing.length === 0;
  const h = hash(readingId);

  const resolvedSpecies: FlowerSpecies =
    species ?? (isFirst ? "iris" : SPECIES[1 + (h % (SPECIES.length - 1))]);

  const reading: StoredReading = {
    readingId,
    sessionToken,
    recoveryCode,
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
