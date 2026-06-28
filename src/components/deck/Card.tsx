"use client";

import { motion } from "framer-motion";

interface CardProps {
  index: number;
  total: number;
  isSelected: boolean;
  isDisabled: boolean;
  onClick: () => void;
}

/* Arc fan geometry — wide spread to fill screen */
function getFanTransform(index: number, total: number): { rotate: number; x: number; y: number } {
  if (total === 1) return { rotate: 0, x: 0, y: 0 };
  const t = index / (total - 1); // 0 → 1
  const angle = (t - 0.5) * 70;  // –35° → +35°
  const x = (t - 0.5) * 320;     // –160px → +160px
  const y = Math.abs(t - 0.5) * 38; // edges lift slightly
  return { rotate: angle, x, y };
}

export function Card({ index, total, isSelected, isDisabled, onClick }: CardProps) {
  const { rotate, x, y } = getFanTransform(index, total);

  return (
    <motion.button
      onClick={isDisabled ? undefined : onClick}
      className="relative focus:outline-none"
      style={{ transformOrigin: "50% 120%" }}
      initial={{ rotate: 0, x: 0, y: 60, opacity: 0 }}
      animate={{
        rotate: isSelected ? 0 : rotate,
        x: isSelected ? 0 : x,
        y: isSelected ? -8 : y,
        opacity: isDisabled && !isSelected ? 0.35 : 1,
        scale: isSelected ? 1.05 : 1,
      }}
      transition={{ duration: 0.55, delay: index * 0.04, ease: [0.4, 0, 0.2, 1] }}
      whileHover={!isDisabled && !isSelected ? { y: y - 6, scale: 1.04 } : {}}
      aria-label={`Card ${index + 1}`}
      aria-pressed={isSelected}
    >
      <CardFace />
    </motion.button>
  );
}

function CardFace() {
  return (
    <div
      className="relative overflow-hidden"
      style={{
        width: 64,
        height: 108,
        borderRadius: 8,
        background: "#12121E",
        border: "1px solid rgba(124, 111, 203, 0.25)",
        boxShadow: "0 4px 24px rgba(0,0,0,0.5), inset 0 0 0 1px rgba(183,174,234,0.04)",
      }}
    >
      {/* Back pattern — faint star */}
      <svg
        width={64} height={108}
        viewBox="0 0 64 108"
        className="absolute inset-0"
        aria-hidden
      >
        {/* Thin border inset */}
        <rect x={5} y={5} width={54} height={98} rx={5}
          fill="none" stroke="#B7AEEA" strokeWidth={0.5} opacity={0.08} />
        {/* Central asterisk / moon */}
        <g transform="translate(32,54)" opacity={0.12}>
          {[0, 45, 90, 135].map((a) => (
            <line
              key={a}
              x1={0} y1={-11} x2={0} y2={11}
              stroke="#ECE9F5"
              strokeWidth={0.8}
              transform={`rotate(${a})`}
            />
          ))}
          <circle cx={0} cy={0} r={2.5} fill="#ECE9F5" />
        </g>
        {/* Corner pips */}
        {[
          [10, 14], [54, 14], [10, 94], [54, 94]
        ].map(([cx, cy], i) => (
          <circle key={i} cx={cx} cy={cy} r={1.5} fill="#B7AEEA" opacity={0.1} />
        ))}
      </svg>

      {/* Subtle top-to-bottom iris gradient */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background: "linear-gradient(160deg, rgba(124,111,203,0.07) 0%, transparent 60%)",
        }}
      />
    </div>
  );
}
