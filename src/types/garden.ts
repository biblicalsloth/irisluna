import type { ReadingStatus } from "@/lib/supabase/types";

export type FlowerStage = "seed" | "bud" | "bloom" | "expired";
export type FlowerSpecies = "iris" | "rose" | "moonflower" | "lavender" | "poppy";

export interface FlowerData {
  id: string;
  readingId: string;
  species: FlowerSpecies;
  stage: FlowerStage;
  status: ReadingStatus;
  isFirstReading: boolean;
  /** Normalized 0–1, resolved to garden container width */
  xNorm: number;
  /** Normalized 0–1, resolved to garden container height from bottom */
  yNorm: number;
  /** -0.08 to 0.08 radians, slight natural lean */
  lean: number;
  /** 0.8 to 1.15 relative scale */
  scale: number;
}

export function readingStatusToStage(status: ReadingStatus): FlowerStage {
  if (status === "pending_payment" || status === "awaiting_response") return "bud";
  if (status === "responded") return "bud";
  if (status === "revealed") return "bloom";
  return "expired";
}
