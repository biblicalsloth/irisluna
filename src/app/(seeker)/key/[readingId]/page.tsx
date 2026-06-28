"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import Link from "next/link";
import { storeReading, setSeeker } from "@/lib/session";
import type { FlowerSpecies } from "@/types/garden";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
const POLL_MS = 3000;
const MAX_POLLS = 40; // ~2 minutes

interface ClaimResult {
  paid: boolean;
  is_new_garden: boolean;
  garden_code: string | null;
  species: string;
  spread_type: "single" | "three";
  seeker_id: string;
  status: string;
}

function KeyPageInner() {
  const { readingId } = useParams<{ readingId: string }>();
  const token = useSearchParams().get("token") ?? "";
  const router = useRouter();

  const [result, setResult] = useState<ClaimResult | null>(null);
  const [timedOut, setTimedOut] = useState(false);
  const pollsRef = useRef(0);
  const storedRef = useRef(false);

  const [emailInput, setEmailInput] = useState("");
  const [emailSent, setEmailSent] = useState(false);
  const [copied, setCopied] = useState(false);

  const claim = useCallback(async (email?: string): Promise<ClaimResult | null> => {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/claim_garden`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${ANON_KEY}` },
      body: JSON.stringify({ reading_id: readingId, session_token: token, email }),
    });
    if (res.status === 409) return null; // not paid yet
    if (!res.ok) return null;
    return await res.json() as ClaimResult;
  }, [readingId, token]);

  // Poll until paid
  useEffect(() => {
    if (!token || !SUPABASE_URL) { setTimedOut(true); return; }
    let active = true;
    const tick = async () => {
      if (!active) return;
      const r = await claim();
      if (!active) return;
      if (r) { setResult(r); return; }
      pollsRef.current += 1;
      if (pollsRef.current >= MAX_POLLS) { setTimedOut(true); return; }
      setTimeout(tick, POLL_MS);
    };
    void tick();
    return () => { active = false; };
  }, [claim, token]);

  // On first paid result, persist to device garden exactly once
  useEffect(() => {
    if (!result || storedRef.current) return;
    storedRef.current = true;
    setSeeker(result.seeker_id, result.garden_code ?? undefined);
    storeReading(readingId, token, result.spread_type, result.species as FlowerSpecies);
  }, [result, readingId, token]);

  async function handleEmail() {
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(emailInput)) return;
    await claim(emailInput);
    setEmailSent(true);
  }

  async function handleCopy() {
    if (!result?.garden_code) return;
    await navigator.clipboard.writeText(result.garden_code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  // Returning user (no new key): straight to the garden
  useEffect(() => {
    if (result && !result.is_new_garden) {
      const t = setTimeout(() => router.replace("/"), 1800);
      return () => clearTimeout(t);
    }
  }, [result, router]);

  if (timedOut && !result) {
    return (
      <main className="flex flex-col items-center justify-center min-h-dvh p-8 text-center">
        <p className="font-display italic text-moonlight/50 text-lg mb-3">payment not confirmed</p>
        <p className="text-muted text-sm mb-8 max-w-[280px] leading-relaxed">
          If you didn&apos;t complete payment, nothing was saved. If you did, give it a moment and refresh.
        </p>
        <Link href="/" className="text-muted/60 text-xs uppercase tracking-[0.18em] hover:text-muted transition-colors">
          ← return
        </Link>
      </main>
    );
  }

  if (!result) {
    return (
      <main className="flex flex-col items-center justify-center min-h-dvh p-8 text-center">
        <motion.div
          style={{ width: 8, height: 8, borderRadius: "50%", background: "#7C6FCB", boxShadow: "0 0 12px 3px #7C6FCB55" }}
          animate={{ opacity: [0.4, 1, 0.4], scale: [0.9, 1.1, 0.9] }}
          transition={{ duration: 2.4, repeat: Infinity, ease: "easeInOut" }}
        />
        <p className="font-display italic text-moonlight/60 text-lg mt-6">confirming payment…</p>
      </main>
    );
  }

  if (!result.is_new_garden) {
    return (
      <main className="flex flex-col items-center justify-center min-h-dvh p-8 text-center">
        <p className="font-display italic text-moonlight/70 text-lg mb-2">added to your garden</p>
        <p className="text-muted text-sm">taking you home…</p>
      </main>
    );
  }

  return (
    <main className="flex flex-col items-center justify-center min-h-dvh px-8 pb-16">
      <motion.div
        className="w-full max-w-xs flex flex-col items-center gap-7 text-center"
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.9, ease: "easeOut" }}
      >
        <div className="flex flex-col items-center gap-1">
          <span className="font-display italic text-moonlight/70 tracking-tight" style={{ fontSize: 22 }}>
            iris luna
          </span>
          <p className="text-muted text-[10px] uppercase tracking-[0.2em]">your garden key</p>
        </div>

        <p className="text-sm leading-relaxed" style={{ color: "rgba(183,174,234,0.55)" }}>
          Keep this safe. It is the only way back to your garden and your readings.
        </p>

        <button
          type="button"
          onClick={() => void handleCopy()}
          className="w-full font-mono text-xl tracking-[0.28em] text-moonlight/90 px-4 py-4 rounded-lg transition-colors"
          style={{ border: "1px solid rgba(124,111,203,0.4)", background: "rgba(124,111,203,0.06)" }}
          aria-label="Copy garden key"
        >
          {result.garden_code}
        </button>
        <p className="text-muted/50 text-[10px] uppercase tracking-[0.16em] -mt-4">
          {copied ? "copied" : "tap to copy"}
        </p>

        {/* Email me the code */}
        <div className="w-full flex flex-col gap-3">
          {emailSent ? (
            <p className="text-[11px] uppercase tracking-[0.15em]" style={{ color: "oklch(0.72 0.078 283)" }}>
              sent — check your inbox
            </p>
          ) : (
            <>
              <input
                type="email"
                value={emailInput}
                onChange={(e) => setEmailInput(e.target.value)}
                placeholder="email me the code"
                className="w-full text-center bg-transparent text-moonlight/80 text-sm px-3 py-2.5 rounded-md outline-none placeholder:text-muted/40"
                style={{ border: "1px solid oklch(0.94 0.018 301 / 0.12)" }}
                autoComplete="email"
                inputMode="email"
              />
              <button
                type="button"
                onClick={() => void handleEmail()}
                className="text-[11px] uppercase tracking-[0.15em] text-muted/70 hover:text-muted transition-colors"
              >
                send it to me
              </button>
            </>
          )}
        </div>

        <button
          type="button"
          onClick={() => router.replace("/")}
          className="w-full py-3 rounded-lg text-sm uppercase tracking-[0.18em] transition-all duration-300"
          style={{ background: "oklch(0.52 0.118 283)", color: "oklch(0.94 0.018 301)" }}
        >
          enter your garden
        </button>
      </motion.div>
    </main>
  );
}

export default function KeyPage() {
  return (
    <Suspense>
      <KeyPageInner />
    </Suspense>
  );
}
