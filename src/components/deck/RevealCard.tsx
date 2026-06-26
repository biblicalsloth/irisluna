"use client";

import { useState } from "react";
import { motion, useReducedMotion } from "framer-motion";

export interface CardRevealData {
  id: number;
  name: string;
  arcana: "major" | "minor";
  suit?: string;
  number?: number;
  upright_meaning: string;
  reversed_meaning: string;
  keywords: string[];
  positionLabel?: string;
  reversed?: boolean;
}

interface RevealCardProps {
  card: CardRevealData;
  delay?: number;
  /** Called when the flip animation completes */
  onFlipped?: () => void;
}

const W = 120;
const H = 196;

export function RevealCard({ card, delay = 0, onFlipped }: RevealCardProps) {
  const [flipped, setFlipped] = useState(false);
  const reduced = useReducedMotion();

  function handleFlip() {
    if (flipped) return;
    setFlipped(true);
    if (reduced) onFlipped?.(); // fire immediately — no animation to wait for
  }

  if (reduced) {
    // Crossfade instead of 3D flip
    return (
      <div
        className="relative cursor-pointer select-none"
        style={{ width: W, height: H }}
        onClick={handleFlip}
        role="button"
        aria-label={flipped ? card.name : "Tap card to reveal"}
        tabIndex={0}
        onKeyDown={(e) => e.key === "Enter" && handleFlip()}
      >
        <motion.div
          style={{ position: "absolute", inset: 0 }}
          initial={{ opacity: 1 }}
          animate={{ opacity: flipped ? 0 : 1 }}
          transition={{ duration: 0.25 }}
        >
          <CardFaceBack />
        </motion.div>
        <motion.div
          style={{ position: "absolute", inset: 0 }}
          initial={{ opacity: 0 }}
          animate={{ opacity: flipped ? 1 : 0 }}
          transition={{ duration: 0.25, delay: flipped ? 0.15 : 0 }}
        >
          <CardFaceFrontFlat card={card} />
        </motion.div>
      </div>
    );
  }

  return (
    <div
      className="relative cursor-pointer select-none"
      style={{ width: W, height: H, perspective: 900 }}
      onClick={handleFlip}
      role="button"
      aria-label={flipped ? card.name : "Flip card to reveal"}
      tabIndex={0}
      onKeyDown={(e) => e.key === "Enter" && handleFlip()}
    >
      <motion.div
        style={{
          width: "100%",
          height: "100%",
          transformStyle: "preserve-3d",
          position: "relative",
        }}
        initial={{ rotateY: 0 }}
        animate={{ rotateY: flipped ? 180 : 0 }}
        transition={{
          delay: flipped ? 0 : delay,
          duration: 0.7,
          ease: [0.45, 0.05, 0.2, 1],
        }}
        onAnimationComplete={() => {
          if (flipped) onFlipped?.();
        }}
      >
        {/* Back face */}
        <CardFaceBack />

        {/* Front face */}
        <CardFaceFront card={card} />
      </motion.div>

      {/* Tap hint — fades out after flip */}
      {!flipped && (
        <motion.div
          className="absolute inset-x-0 -bottom-6 flex justify-center"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: delay + 0.6, duration: 0.5 }}
        >
          <span
            className="text-[9px] uppercase tracking-[0.18em]"
            style={{ color: "rgba(183,174,234,0.3)" }}
          >
            tap
          </span>
        </motion.div>
      )}
    </div>
  );
}

// ── Back face ─────────────────────────────────────────────────────────────────

function CardFaceBack() {
  const COLS = 5;
  const ROWS = 8;
  const cx = W / 2;
  const cy = H / 2;

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        backfaceVisibility: "hidden",
        WebkitBackfaceVisibility: "hidden",
      }}
    >
      <svg
        width={W}
        height={H}
        viewBox={`0 0 ${W} ${H}`}
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden
        style={{ display: "block" }}
      >
        <rect x={0.75} y={0.75} width={W - 1.5} height={H - 1.5} rx={8} fill="#12121E" stroke="rgba(124,111,203,0.22)" strokeWidth={1.5} />
        <rect x={6} y={6} width={W - 12} height={H - 12} rx={5.5} fill="none" stroke="rgba(124,111,203,0.08)" strokeWidth={0.75} />

        {Array.from({ length: ROWS }).map((_, row) =>
          Array.from({ length: COLS }).map((_, col) => {
            const x = 14 + col * ((W - 28) / (COLS - 1));
            const y = 16 + row * ((H - 32) / (ROWS - 1));
            return (
              <g key={`${row}-${col}`} transform={`translate(${x},${y})`} opacity={0.15}>
                <line x1={-3} y1={0} x2={3} y2={0} stroke="#B7AEEA" strokeWidth={0.8} />
                <line x1={0} y1={-3} x2={0} y2={3} stroke="#B7AEEA" strokeWidth={0.8} />
                <line x1={-2.1} y1={-2.1} x2={2.1} y2={2.1} stroke="#B7AEEA" strokeWidth={0.8} />
                <line x1={2.1} y1={-2.1} x2={-2.1} y2={2.1} stroke="#B7AEEA" strokeWidth={0.8} />
              </g>
            );
          })
        )}

        <g transform={`translate(${cx},${cy})`} opacity={0.2}>
          <circle cx={0} cy={0} r={10} stroke="#7C6FCB" strokeWidth={0.75} />
          <line x1={0} y1={-7} x2={0} y2={7} stroke="#7C6FCB" strokeWidth={0.75} />
          <line x1={-7} y1={0} x2={7} y2={0} stroke="#7C6FCB" strokeWidth={0.75} />
        </g>

        {[
          [11, 13], [W - 11, 13], [11, H - 13], [W - 11, H - 13],
        ].map(([x, y], i) => (
          <circle key={i} cx={x} cy={y} r={2} fill="#7C6FCB" opacity={0.25} />
        ))}
      </svg>
    </div>
  );
}

// ── Front face (reduced-motion flat version — no rotateY transform) ───────────

function CardFaceFrontFlat({ card }: { card: CardRevealData }) {
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        borderRadius: 8,
        background: "#0D0D18",
        border: "1px solid rgba(124,111,203,0.28)",
        display: "flex",
        flexDirection: "column",
        padding: "10px 10px 12px",
        overflow: "hidden",
      }}
    >
      <CardFaceFrontContent card={card} />
    </div>
  );
}

// ── Front face ────────────────────────────────────────────────────────────────

function CardFaceFront({ card }: { card: CardRevealData }) {
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        backfaceVisibility: "hidden",
        WebkitBackfaceVisibility: "hidden",
        transform: "rotateY(180deg)",
        borderRadius: 8,
        background: "#0D0D18",
        border: "1px solid rgba(124,111,203,0.28)",
        display: "flex",
        flexDirection: "column",
        padding: "10px 10px 12px",
        overflow: "hidden",
      }}
    >
      <CardFaceFrontContent card={card} />
    </div>
  );
}

function CardFaceFrontContent({ card }: { card: CardRevealData }) {
  const meaning = card.reversed ? card.reversed_meaning : card.upright_meaning;
  return (
    <>
      {card.positionLabel && (
        <p style={{ fontSize: 8, letterSpacing: "0.18em", textTransform: "uppercase", color: "rgba(183,174,234,0.35)", marginBottom: 6, textAlign: "center" }}>
          {card.positionLabel}
        </p>
      )}
      <p style={{ fontFamily: "var(--font-fraunces)", fontStyle: "italic", fontSize: 13, lineHeight: 1.25, color: "rgba(236,233,245,0.88)", textAlign: "center", marginBottom: 4 }}>
        {card.name}
      </p>
      {card.reversed && (
        <p style={{ fontSize: 7.5, letterSpacing: "0.14em", textTransform: "uppercase", color: "rgba(217,178,106,0.55)", textAlign: "center", marginBottom: 6 }}>
          reversed
        </p>
      )}
      <div style={{ height: 1, background: "linear-gradient(to right, transparent, rgba(124,111,203,0.2), transparent)", marginBottom: 8, marginTop: card.reversed ? 0 : 4 }} />
      <p style={{ fontSize: 10, lineHeight: 1.55, color: "rgba(183,174,234,0.5)", textAlign: "center", flex: 1, overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 5, WebkitBoxOrient: "vertical" }}>
        {meaning}
      </p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 3, justifyContent: "center", marginTop: 8 }}>
        {card.keywords.slice(0, 3).map((kw) => (
          <span key={kw} style={{ fontSize: 7, letterSpacing: "0.12em", textTransform: "uppercase", color: "rgba(124,111,203,0.45)", background: "rgba(124,111,203,0.08)", borderRadius: 3, padding: "2px 4px" }}>
            {kw}
          </span>
        ))}
      </div>
    </>
  );
}
