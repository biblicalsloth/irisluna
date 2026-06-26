"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { getStoredReadings } from "@/lib/session";
import type { StoredReading } from "@/lib/session";
import type { ReadingStatus } from "@/lib/supabase/types";

const STATUS_LABEL: Record<ReadingStatus, string> = {
  pending_payment:   "verifying payment",
  awaiting_response: "waiting for reader",
  responded:         "response ready",
  revealed:          "revealed",
  expired:           "expired",
};

const STATUS_COLOR: Record<ReadingStatus, string> = {
  pending_payment:   "oklch(0.75 0.12 60)",
  awaiting_response: "oklch(0.72 0.078 283)",
  responded:         "oklch(0.62 0.104 163)",
  revealed:          "oklch(0.62 0.104 163 / 0.7)",
  expired:           "oklch(0.44 0.024 283 / 0.6)",
};

export default function ReadingsPage() {
  const [readings, setReadings] = useState<StoredReading[]>([]);

  useEffect(() => {
    const all = getStoredReadings();
    setReadings([...all].reverse()); // newest first
  }, []);

  return (
    <main className="flex flex-col min-h-dvh px-6 pt-10 pb-20 max-w-sm mx-auto">
      <motion.div
        initial={{ opacity: 0, y: -4 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.7 }}
        className="mb-8 flex items-baseline justify-between"
      >
        <span
          className="font-display italic text-moonlight/70 tracking-tight"
          style={{ fontSize: 20 }}
        >
          your readings
        </span>
        <Link
          href="/"
          className="text-muted/50 text-[10px] uppercase tracking-[0.14em] hover:text-muted transition-colors"
        >
          ← garden
        </Link>
      </motion.div>

      {readings.length === 0 ? (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.2, duration: 0.7 }}
          className="flex flex-col items-center justify-center flex-1 text-center py-20"
        >
          <p className="font-display italic text-moonlight/40 text-lg mb-2">no readings yet</p>
          <p className="text-muted text-sm mb-8">Ask a question to begin.</p>
          <Link
            href="/ask"
            className="text-iris-300/60 text-xs uppercase tracking-[0.18em] hover:text-iris-300 transition-colors"
          >
            ask →
          </Link>
        </motion.div>
      ) : (
        <div className="flex flex-col gap-2">
          {readings.map((r, i) => (
            <ReadingRow key={r.readingId} reading={r} index={i} />
          ))}
        </div>
      )}
    </main>
  );
}

function ReadingRow({ reading, index }: { reading: StoredReading; index: number }) {
  const href =
    reading.status === "responded" || reading.status === "revealed"
      ? `/reveal/${reading.readingId}`
      : reading.status === "expired"
      ? "#"
      : `/wait/${reading.readingId}`;

  const isExpired = reading.status === "expired";

  const inner = (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.06, duration: 0.35 }}
      className="flex items-center justify-between px-4 py-3.5 rounded-lg"
      style={{
        border: `1px solid oklch(0.94 0.018 301 / ${isExpired ? "0.04" : "0.07"})`,
        opacity: isExpired ? 0.5 : 1,
      }}
    >
      <div className="flex items-center gap-3">
        {/* Flower species dot */}
        <SpeciesDot species={reading.species} stage={reading.stage} />

        <div className="flex flex-col gap-0.5">
          <span className="text-xs" style={{ color: "oklch(0.94 0.018 301 / 0.65)" }}>
            {reading.spreadType === "single" ? "1-card" : "3-card"} · {timeAgo(reading.createdAt)}
          </span>
          <span
            className="text-[10px] uppercase tracking-[0.12em]"
            style={{ color: STATUS_COLOR[reading.status] }}
          >
            {STATUS_LABEL[reading.status]}
          </span>
        </div>
      </div>

      {!isExpired && (
        <span className="text-muted/40 text-xs">→</span>
      )}
    </motion.div>
  );

  if (isExpired) return <div>{inner}</div>;

  return <Link href={href}>{inner}</Link>;
}

function SpeciesDot({ species, stage }: { species: string; stage: string }) {
  const colors: Record<string, string> = {
    iris:       "#7C6FCB",
    rose:       "#CB6F8B",
    moonflower: "#ECE9F5",
    lavender:   "#A89CCB",
    poppy:      "#CB8B6F",
  };
  const color = colors[species] ?? "#6C6A82";
  const isBloom = stage === "bloom";

  return (
    <div
      style={{
        width: 8,
        height: 8,
        borderRadius: "50%",
        background: color,
        opacity: isBloom ? 1 : 0.45,
        boxShadow: isBloom ? `0 0 6px 2px ${color}55` : "none",
        flexShrink: 0,
      }}
    />
  );
}

function timeAgo(ms: number): string {
  const diff = Date.now() - ms;
  const m = Math.floor(diff / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}
