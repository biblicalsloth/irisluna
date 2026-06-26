"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import dynamic from "next/dynamic";
import { Garden } from "@/components/garden/Garden";
import { HoldToRecord } from "@/components/audio/HoldToRecord";
import type { FlowerData } from "@/types/garden";
import { getStoredReadings } from "@/lib/session";
import { hasOnboarded } from "./onboarding/page";
import { useFlowStore } from "@/lib/flow/store";

const Aurora = dynamic(() => import("@/components/Aurora"), { ssr: false });

export default function GardenPage() {
  const router = useRouter();
  const setRecording = useFlowStore((s) => s.setRecording);
  const [flowers, setFlowers] = useState<FlowerData[]>([]);
  const [seed, setSeed] = useState(0);

  useEffect(() => {
    if (!hasOnboarded()) {
      router.replace("/onboarding");
      return;
    }
    const stored = getStoredReadings();
    if (stored.length > 0) {
      const firstId = stored[0].readingId;
      setSeed(firstId.charCodeAt(0) * 997 + firstId.charCodeAt(4) * 31);
    }
    setFlowers(
      stored.map((r, i) => ({
        id: r.readingId,
        readingId: r.readingId,
        species: r.species,
        stage: r.stage,
        status: r.status,
        isFirstReading: i === 0,
        xNorm: r.xNorm,
        yNorm: r.yNorm,
        lean: r.lean,
        scale: r.scale,
      })),
    );
  }, []);

  function handleFlowerClick(flower: FlowerData) {
    if (flower.status === "responded" || flower.status === "revealed") {
      router.push(`/reveal/${flower.readingId}`);
    } else {
      router.push(`/wait/${flower.readingId}`);
    }
  }

  function handleRecordComplete(blob: Blob, mimeType: string, durationMs: number) {
    setRecording(blob, mimeType, durationMs);
    router.push("/deck");
  }

  return (
    <main className="relative flex flex-col min-h-dvh">
      {/* Aurora WebGL background — screen blend adds glow without replacing dark base */}
      <div className="fixed inset-0 z-0 pointer-events-none" style={{ mixBlendMode: "screen" }}>
        <Aurora
          colorStops={["#5227FF", "#7cff67", "#5227FF"]}
          amplitude={1}
          blend={0.2}
        />
      </div>

      {/* Garden as decorative background layer */}
      <div className="absolute inset-0 z-10 flex flex-col">
        <Garden flowers={flowers} seed={seed} onFlowerClick={handleFlowerClick} />
      </div>

      {/* Header */}
      <motion.header
        initial={{ opacity: 0, y: -6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 1, ease: "easeOut" }}
        className="relative z-20 flex items-start justify-between px-6 pt-8 pb-4"
      >
        <div className="flex flex-col gap-0.5">
          <span
            className="font-display italic text-moonlight/80 tracking-tight leading-none"
            style={{ fontSize: 22 }}
          >
            iris luna
          </span>
          <span className="text-muted text-[10px] uppercase tracking-[0.18em]">
            a reading with a human
          </span>
        </div>

        {flowers.length > 0 && (
          <motion.button
            onClick={() => router.push("/readings")}
            className="text-muted text-[11px] uppercase tracking-[0.14em] hover:text-moonlight/60 transition-colors cursor-pointer mt-1"
          >
            readings
          </motion.button>
        )}
      </motion.header>

      {/* Centered record button */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.5, duration: 1, ease: "easeOut" }}
        className="relative z-20 flex-1 flex items-center justify-center"
      >
        <HoldToRecord
          onComplete={handleRecordComplete}
          label="tap and hold to ask"
        />
      </motion.div>

      {/* Crisis link + settings */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 1.4, duration: 1 }}
        className="relative z-20 flex items-center justify-center gap-4 pb-6"
      >
        <a
          href="https://www.opencounseling.com/hotlines-ph"
          target="_blank"
          rel="noopener noreferrer"
          className="text-[9px] uppercase tracking-[0.16em] transition-colors hover:text-muted"
          style={{ color: "oklch(0.44 0.024 283 / 0.45)" }}
        >
          need support?
        </a>
        <span style={{ color: "oklch(0.44 0.024 283 / 0.2)" }} aria-hidden>·</span>
        <button
          type="button"
          onClick={() => router.push("/settings")}
          className="text-[9px] uppercase tracking-[0.16em] transition-colors hover:text-muted"
          style={{ color: "oklch(0.44 0.024 283 / 0.45)" }}
        >
          settings
        </button>
      </motion.div>
    </main>
  );
}
