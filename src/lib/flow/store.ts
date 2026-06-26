import { create } from "zustand";
import type { SpreadType } from "@/lib/supabase/types";

interface FlowState {
  blob: Blob | null;
  mimeType: string;
  durationMs: number;
  spreadType: SpreadType | null;
  positions: number[];

  setRecording: (blob: Blob, mimeType: string, durationMs: number) => void;
  setSpreadType: (type: SpreadType) => void;
  setPositions: (positions: number[]) => void;
  clear: () => void;
}

export const useFlowStore = create<FlowState>((set) => ({
  blob: null,
  mimeType: "",
  durationMs: 0,
  spreadType: null,
  positions: [],

  setRecording: (blob, mimeType, durationMs) =>
    set({ blob, mimeType, durationMs }),

  setSpreadType: (type) => set({ spreadType: type }),

  setPositions: (positions) => set({ positions }),

  clear: () =>
    set({
      blob: null,
      mimeType: "",
      durationMs: 0,
      spreadType: null,
      positions: [],
    }),
}));
