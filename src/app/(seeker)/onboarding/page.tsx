"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";

const ONBOARDED_KEY = "il_onboarded";

export function markOnboarded() {
  if (typeof window !== "undefined") {
    localStorage.setItem(ONBOARDED_KEY, "1");
  }
}

export function hasOnboarded(): boolean {
  if (typeof window === "undefined") return false;
  return localStorage.getItem(ONBOARDED_KEY) === "1";
}

export default function OnboardingPage() {
  const router = useRouter();

  useEffect(() => {
    // Already onboarded — skip
    if (hasOnboarded()) router.replace("/");
  }, [router]);

  function handleBegin() {
    markOnboarded();
    router.replace("/");
  }

  return (
    <main
      className="flex flex-col items-center justify-center min-h-dvh px-8 select-none"
      onClick={handleBegin}
      style={{ cursor: "default" }}
    >
      {/* Ambient glow */}
      <div
        aria-hidden
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            "radial-gradient(ellipse 55% 45% at 50% 42%, oklch(0.52 0.118 283 / 0.07) 0%, transparent 70%)",
        }}
      />

      <div className="relative flex flex-col items-center gap-10 max-w-xs text-center">
        {/* Iris glyph */}
        <motion.div
          initial={{ opacity: 0, scale: 0.88 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 1.6, ease: [0.22, 1, 0.36, 1] }}
        >
          <IrisGlyph />
        </motion.div>

        {/* Wordmark */}
        <motion.div
          className="flex flex-col items-center gap-1"
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.5, duration: 1.2, ease: "easeOut" }}
        >
          <span
            className="font-display italic tracking-tight leading-none"
            style={{ fontSize: 28, color: "oklch(0.94 0.018 301 / 0.75)" }}
          >
            iris luna
          </span>
          <span
            className="text-[10px] uppercase tracking-[0.22em]"
            style={{ color: "oklch(0.44 0.024 283)" }}
          >
            a reading with a human
          </span>
        </motion.div>

        {/* What this is */}
        <motion.div
          className="flex flex-col gap-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 1, duration: 1.2 }}
        >
          <p
            className="text-sm leading-relaxed"
            style={{ color: "oklch(0.94 0.018 301 / 0.45)" }}
          >
            You speak a question. You pull cards. A real person — not an AI — hears your voice and answers.
          </p>
          <p
            className="text-sm leading-relaxed"
            style={{ color: "oklch(0.94 0.018 301 / 0.35)" }}
          >
            Your cards stay face-down until the human responds. The wait is part of the ritual.
          </p>
          <p
            className="text-[11px] leading-relaxed"
            style={{ color: "oklch(0.44 0.024 283 / 0.8)" }}
          >
            Voice notes are heard by a real person. Iris Luna is not a medical, legal, or crisis service. If you need support now, please reach out to a professional.
          </p>
        </motion.div>

        {/* Tap cue */}
        <motion.p
          className="text-[10px] uppercase tracking-[0.22em]"
          style={{ color: "oklch(0.44 0.024 283 / 0.5)" }}
          initial={{ opacity: 0 }}
          animate={{ opacity: [0, 0.8, 0.4, 0.8] }}
          transition={{ delay: 1.8, duration: 2.4, ease: "easeInOut", repeat: Infinity, repeatType: "reverse" }}
        >
          tap anywhere to begin
        </motion.p>
      </div>
    </main>
  );
}

function IrisGlyph() {
  return (
    <svg width="72" height="72" viewBox="0 0 72 72" fill="none" aria-hidden>
      <circle cx="36" cy="36" r="28" stroke="oklch(0.52 0.118 283 / 0.22)" strokeWidth="1" />
      <circle cx="36" cy="36" r="18" stroke="oklch(0.52 0.118 283 / 0.14)" strokeWidth="0.75" />
      {/* Petals */}
      {Array.from({ length: 8 }).map((_, i) => {
        const angle = (i * Math.PI * 2) / 8;
        const r1 = 10, r2 = 26;
        const x1 = 36 + Math.cos(angle) * r1;
        const y1 = 36 + Math.sin(angle) * r1;
        const x2 = 36 + Math.cos(angle) * r2;
        const y2 = 36 + Math.sin(angle) * r2;
        return (
          <line
            key={i}
            x1={x1} y1={y1} x2={x2} y2={y2}
            stroke="oklch(0.72 0.078 283 / 0.3)"
            strokeWidth="0.75"
          />
        );
      })}
      {/* Center */}
      <circle cx="36" cy="36" r="3.5" fill="oklch(0.52 0.118 283 / 0.45)" />
      <circle cx="36" cy="36" r="1.5" fill="oklch(0.72 0.078 283 / 0.6)" />
    </svg>
  );
}
