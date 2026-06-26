"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import Link from "next/link";
import { getStoredReadings, updateReadingStatus, storeReading } from "@/lib/session";
import type { StoredReading } from "@/lib/session";
import type { ReadingStatus } from "@/lib/supabase/types";
import { readingStatusToStage } from "@/types/garden";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
const POLL_MS = 30_000;

function WaitPageInner() {
  const { readingId } = useParams<{ readingId: string }>();
  const searchParams = useSearchParams();
  const router = useRouter();

  const [reading, setReading] = useState<StoredReading | "not_found" | null>(null);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Find stored reading; also accept ?token= from email deep links
  useEffect(() => {
    const stored = getStoredReadings();
    const found = stored.find((r) => r.readingId === readingId);

    if (found) {
      setReading(found);
      return;
    }

    // Email deep link: ?token=... for seekers who cleared localStorage
    const token = searchParams.get("token");
    if (token) {
      // Persist so subsequent page loads don't lose the reading
      const persisted = storeReading(readingId, token, "three");
      setReading(persisted);
      return;
    }

    setReading("not_found");
  }, [readingId, searchParams]);

  // Poll get_reading_status every 30s
  useEffect(() => {
    if (!reading || reading === "not_found") return;
    if (reading.status === "responded" || reading.status === "revealed" || reading.status === "expired") return;
    if (!SUPABASE_URL) return;

    async function poll() {
      if (!reading || reading === "not_found") return;

      try {
        const res = await fetch(`${SUPABASE_URL}/functions/v1/get_reading_status`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${ANON_KEY}`,
          },
          body: JSON.stringify({
            reading_id: readingId,
            session_token: reading.sessionToken,
          }),
        });

        if (!res.ok) return;

        const data = await res.json() as { status: ReadingStatus };
        if (data.status && data.status !== reading.status) {
          const stage = readingStatusToStage(data.status);
          updateReadingStatus(readingId, data.status, stage);
          setReading((prev) =>
            prev && prev !== "not_found"
              ? { ...prev, status: data.status, stage }
              : prev,
          );
        }
      } catch {
        // silently ignore poll errors
      }
    }

    void poll(); // immediate first poll
    pollingRef.current = setInterval(() => void poll(), POLL_MS);
    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current);
    };
  }, [reading, readingId]);

  // Redirect when status becomes responded
  useEffect(() => {
    if (!reading || reading === "not_found") return;
    if (reading.status === "responded" || reading.status === "revealed") {
      router.replace(`/reveal/${readingId}`);
    }
  }, [reading, readingId, router]);

  if (reading === null) return null;

  if (reading === "not_found") {
    return (
      <main className="flex flex-col items-center justify-center min-h-dvh p-8 text-center">
        <p className="font-display italic text-moonlight/50 text-lg mb-3">nothing here</p>
        <p className="text-muted text-sm mb-8">This reading doesn't belong to this device.</p>
        <Link href="/" className="text-muted/60 text-xs uppercase tracking-[0.18em] hover:text-muted transition-colors">
          ← return
        </Link>
      </main>
    );
  }

  const cardCount = reading.spreadType === "single" ? 1 : 3;

  return (
    <main className="relative flex flex-col items-center justify-center min-h-dvh overflow-hidden select-none">
      {/* Moon glow */}
      <div
        aria-hidden
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            "radial-gradient(ellipse 60% 40% at 50% 38%, oklch(0.52 0.118 283 / 0.06) 0%, transparent 70%)",
        }}
      />

      {/* Floating face-down cards */}
      <div
        className="relative flex items-end justify-center mb-14"
        style={{ gap: cardCount === 1 ? 0 : 20, height: 200 }}
      >
        {Array.from({ length: cardCount }).map((_, i) => (
          <FaceDownCard key={i} index={i} total={cardCount} />
        ))}
      </div>

      <AnimatePresence mode="wait">
        <StatusCopy key={reading.status} status={reading.status} />
      </AnimatePresence>

      {/* Recovery code — shown only while waiting */}
      {reading.recoveryCode && reading.status === "pending_payment" && (
        <motion.div
          className="flex flex-col items-center gap-1 mt-8"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 1.6, duration: 0.8 }}
        >
          <p className="text-[9px] uppercase tracking-[0.18em]" style={{ color: "rgba(108,106,130,0.5)" }}>
            recovery code
          </p>
          <p
            className="font-mono text-base tracking-[0.22em]"
            style={{ color: "rgba(183,174,234,0.55)" }}
          >
            {reading.recoveryCode}
          </p>
          <p className="text-[9px] text-center max-w-[200px] leading-relaxed mt-1" style={{ color: "rgba(108,106,130,0.4)" }}>
            screenshot this to restore your reading on another device
          </p>
        </motion.div>
      )}

      <motion.div
        className="absolute bottom-10"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 1.2, duration: 0.8 }}
      >
        <Link href="/" className="text-muted/40 text-[10px] uppercase tracking-[0.18em] hover:text-muted/70 transition-colors">
          ← home
        </Link>
      </motion.div>
    </main>
  );
}

export default function WaitPage() {
  return (
    <Suspense>
      <WaitPageInner />
    </Suspense>
  );
}

// ── Face-down card ────────────────────────────────────────────────────────────

function FaceDownCard({ index, total }: { index: number; total: number }) {
  const tilt = total === 1 ? 0 : (index - (total - 1) / 2) * 4;
  const floatDuration = 3.8 + index * 0.4;
  const reduced = useReducedMotion();

  return (
    <motion.div
      initial={{ opacity: 0, y: reduced ? 0 : 24 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.2 + index * 0.18, duration: reduced ? 0.3 : 0.9, ease: [0.22, 1, 0.36, 1] }}
      style={{ rotate: tilt }}
    >
      <motion.div
        animate={reduced ? {} : { y: [0, -6, 0] }}
        transition={{ duration: floatDuration, repeat: Infinity, ease: "easeInOut", delay: index * 0.6 }}
      >
        <CardBack />
      </motion.div>
    </motion.div>
  );
}

function CardBack() {
  const W = 90, H = 148, COLS = 4, ROWS = 6, cx = W / 2, cy = H / 2;
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} fill="none" aria-hidden>
      <rect x={0.75} y={0.75} width={W - 1.5} height={H - 1.5} rx={6} fill="#12121E" stroke="rgba(124,111,203,0.22)" strokeWidth={1.5} />
      <rect x={5} y={5} width={W - 10} height={H - 10} rx={4} fill="none" stroke="rgba(124,111,203,0.09)" strokeWidth={0.75} />
      {Array.from({ length: ROWS }).map((_, row) =>
        Array.from({ length: COLS }).map((_, col) => {
          const x = 12 + col * ((W - 24) / (COLS - 1));
          const y = 14 + row * ((H - 28) / (ROWS - 1));
          return (
            <g key={`${row}-${col}`} transform={`translate(${x},${y})`} opacity={0.18}>
              <line x1={-3} y1={0} x2={3} y2={0} stroke="#B7AEEA" strokeWidth={0.8} />
              <line x1={0} y1={-3} x2={0} y2={3} stroke="#B7AEEA" strokeWidth={0.8} />
              <line x1={-2.1} y1={-2.1} x2={2.1} y2={2.1} stroke="#B7AEEA" strokeWidth={0.8} />
              <line x1={2.1} y1={-2.1} x2={-2.1} y2={2.1} stroke="#B7AEEA" strokeWidth={0.8} />
            </g>
          );
        })
      )}
      <g transform={`translate(${cx},${cy})`} opacity={0.22}>
        <circle cx={0} cy={0} r={8} stroke="#7C6FCB" strokeWidth={0.75} />
        <line x1={0} y1={-5} x2={0} y2={5} stroke="#7C6FCB" strokeWidth={0.75} />
        <line x1={-5} y1={0} x2={5} y2={0} stroke="#7C6FCB" strokeWidth={0.75} />
      </g>
      {[[9, 10], [W - 9, 10], [9, H - 10], [W - 9, H - 10]].map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r={1.5} fill="#7C6FCB" opacity={0.28} />
      ))}
    </svg>
  );
}

// ── Status copy ───────────────────────────────────────────────────────────────

function StatusCopy({ status }: { status: ReadingStatus }) {
  return (
    <motion.div
      className="flex flex-col items-center text-center px-8"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -4 }}
      transition={{ duration: 0.7, ease: "easeOut" }}
    >
      {status === "pending_payment" && (
        <>
          <PulsingOrb />
          <p className="font-display italic text-moonlight/60 text-lg mt-5 mb-2">
            Payment received — verifying.
          </p>
          <p className="text-muted text-sm leading-relaxed max-w-[260px]">
            Usually within a few hours.
          </p>
        </>
      )}
      {status === "awaiting_response" && (
        <>
          <PulsingOrb color="#B7AEEA" />
          <p className="font-display italic text-moonlight/70 text-lg mt-5 mb-2">
            Payment verified. Waiting for the human to give a response.
          </p>
        </>
      )}
      {status === "expired" && (
        <>
          <p className="font-display italic text-moonlight/40 text-lg mb-2">
            The window has closed.
          </p>
          <p className="text-muted/70 text-sm leading-relaxed max-w-[260px] mb-8">
            This reading has expired. The cards are waiting for a new question.
          </p>
          <Link href="/" className="text-iris-300/60 text-xs uppercase tracking-[0.18em] hover:text-iris-300 transition-colors">
            ask again
          </Link>
        </>
      )}
    </motion.div>
  );
}

function PulsingOrb({ color = "#7C6FCB" }: { color?: string }) {
  return (
    <motion.div
      style={{ width: 8, height: 8, borderRadius: "50%", background: color, boxShadow: `0 0 12px 3px ${color}55` }}
      animate={{ opacity: [0.4, 1, 0.4], scale: [0.9, 1.1, 0.9] }}
      transition={{ duration: 2.4, repeat: Infinity, ease: "easeInOut" }}
    />
  );
}
