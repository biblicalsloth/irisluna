"use client";

import { motion } from "framer-motion";
import type { FlowerSpecies, FlowerStage } from "@/types/garden";

interface FlowerProps {
  species: FlowerSpecies;
  stage: FlowerStage;
  isFirstReading?: boolean;
  onClick?: () => void;
}

const IRIS_C = { fall: "#7C6FCB", std: "#B7AEEA", beard: "#D9B26A", stem: "#6FA887" };
const ROSE_C = { outer: "#C47B8C", inner: "#D4A0B0", center: "#E8C0C8", stem: "#6FA887" };
const MOON_C = { petal: "#D8D4EC", vein: "#9990C4", center: "#B7AEEA", stem: "#6FA887" };
const LAVEN_C = { bud: "#8879C2", stem: "#7A9B80" };
const POPPY_C = { petal: "#CC8A3A", dark: "#0A0A12", mid: "#12121E", stamen: "#D9B26A", stem: "#6FA887" };

/* ─── Iris (the namesake) ───────────────────────────── */
function IrisBloom({ gold }: { gold?: boolean }) {
  const fallColor = gold ? "#D9B26A" : IRIS_C.fall;
  const stdColor = gold ? "#F0D89A" : IRIS_C.std;
  return (
    <g>
      {/* Stem */}
      <path d="M24,100 L24,62" stroke={IRIS_C.stem} strokeWidth={1.5} strokeLinecap="round" />
      {/* Leaves */}
      <path d="M24,90 C16,84 8,80 4,72" stroke={IRIS_C.stem} strokeWidth={1.4} strokeLinecap="round" fill="none" />
      <path d="M24,85 C32,79 40,75 44,67" stroke={IRIS_C.stem} strokeWidth={1.4} strokeLinecap="round" fill="none" />
      {/* Falls */}
      <path d="M24,44 C18,40 8,42 4,52 C6,62 16,66 24,60 Z" fill={fallColor} opacity={0.9} />
      <path d="M24,44 C30,40 40,42 44,52 C42,62 32,66 24,60 Z" fill={fallColor} opacity={0.9} />
      <path d="M24,48 C21,55 18,65 20,75 C22,79 26,79 28,75 C30,65 27,55 24,48 Z" fill={fallColor} />
      {/* Beards */}
      <path d="M23,52 L23,66" stroke={IRIS_C.beard} strokeWidth={1.5} strokeLinecap="round" opacity={0.8} />
      {/* Standards */}
      <path d="M24,44 C20,36 14,20 16,8 C18,2 24,4 24,14 Z" fill={stdColor} opacity={0.9} />
      <path d="M24,44 C28,36 34,20 32,8 C30,2 24,4 24,14 Z" fill={stdColor} opacity={0.9} />
      <path d="M24,44 C22,34 20,18 24,4 C26,-1 28,2 26,14 C25,28 24,38 24,44 Z" fill={stdColor} opacity={0.85} />
    </g>
  );
}

function IrisBud() {
  return (
    <g>
      <path d="M24,100 L24,56" stroke={IRIS_C.stem} strokeWidth={1.5} strokeLinecap="round" />
      <path d="M24,90 C18,84 10,80 7,73" stroke={IRIS_C.stem} strokeWidth={1.2} strokeLinecap="round" fill="none" />
      <path d="M24,56 C20,50 18,42 20,34 C21,28 27,28 28,34 C30,42 28,50 24,56 Z" fill={IRIS_C.fall} opacity={0.85} />
      <path d="M23,58 L21,48" stroke={IRIS_C.stem} strokeWidth={0.8} opacity={0.6} />
      <path d="M25,58 L27,48" stroke={IRIS_C.stem} strokeWidth={0.8} opacity={0.6} />
    </g>
  );
}

function IrisSeed() {
  return <ellipse cx={24} cy={98} rx={3} ry={2} fill={IRIS_C.fall} opacity={0.5} />;
}

/* ─── Rose ──────────────────────────────────────────── */
function RoseBloom() {
  return (
    <g>
      <path d="M24,100 L24,66" stroke={ROSE_C.stem} strokeWidth={1.5} strokeLinecap="round" />
      {/* Thorns */}
      <path d="M22,80 L18,76" stroke={ROSE_C.stem} strokeWidth={0.8} strokeLinecap="round" />
      <path d="M26,88 L30,84" stroke={ROSE_C.stem} strokeWidth={0.8} strokeLinecap="round" />
      {/* Leaves */}
      <path d="M24,78 C14,72 8,66 6,58 C10,52 18,56 22,64 Z" fill={ROSE_C.stem} />
      <path d="M24,74 C34,68 40,62 42,54 C38,48 30,52 26,60 Z" fill={ROSE_C.stem} />
      {/* Sepals */}
      <path d="M24,63 C16,60 10,62 8,66 C12,70 18,68 24,66 Z" fill="#4E8A6A" />
      <path d="M24,63 C32,60 38,62 40,66 C36,70 30,68 24,66 Z" fill="#4E8A6A" />
      {/* Outer petals — 5 rotated ellipses */}
      {[0, 72, 144, 216, 288].map((a) => (
        <ellipse key={a} cx={24} cy={28} rx={8} ry={11} fill={ROSE_C.outer} opacity={0.92} transform={`rotate(${a} 24 44)`} />
      ))}
      {/* Inner petals — offset 36° */}
      {[36, 108, 180, 252, 324].map((a) => (
        <ellipse key={a} cx={24} cy={34} rx={5.5} ry={7.5} fill={ROSE_C.inner} transform={`rotate(${a} 24 44)`} />
      ))}
      <circle cx={24} cy={44} r={6} fill={ROSE_C.center} />
      <circle cx={24} cy={44} r={3} fill={ROSE_C.inner} />
    </g>
  );
}

function RoseBud() {
  return (
    <g>
      <path d="M24,100 L24,58" stroke={ROSE_C.stem} strokeWidth={1.5} strokeLinecap="round" />
      <path d="M24,80 C16,74 8,70 6,62 C10,56 18,60 22,68 Z" fill={ROSE_C.stem} />
      <path d="M24,58 C20,52 18,44 20,36 C21,30 27,30 28,36 C30,44 28,52 24,58 Z" fill={ROSE_C.outer} opacity={0.85} />
      <path d="M22,60 L19,50" stroke="#4E8A6A" strokeWidth={0.9} opacity={0.6} />
      <path d="M26,60 L29,50" stroke="#4E8A6A" strokeWidth={0.9} opacity={0.6} />
    </g>
  );
}

/* ─── Moon flower ───────────────────────────────────── */
function MoonflowerBloom() {
  return (
    <g>
      <path d="M24,100 L24,66" stroke={MOON_C.stem} strokeWidth={1.5} strokeLinecap="round" />
      {/* Twining leaf */}
      <path d="M24,84 C14,78 8,72 6,64 C10,58 18,62 22,70 Z" fill={MOON_C.stem} />
      {/* 5 petals radiating */}
      {[0, 72, 144, 216, 288].map((a) => (
        <ellipse key={a} cx={24} cy={25} rx={10} ry={14} fill={MOON_C.petal} opacity={0.88} transform={`rotate(${a} 24 44)`} />
      ))}
      {/* Petal veins */}
      {[0, 72, 144, 216, 288].map((a) => (
        <line key={a} x1={24} y1={44} x2={24} y2={18} stroke={MOON_C.vein} strokeWidth={0.7} opacity={0.45} transform={`rotate(${a} 24 44)`} />
      ))}
      <circle cx={24} cy={44} r={8} fill={MOON_C.center} />
      <circle cx={24} cy={44} r={4} fill="#ECE9F5" />
      {/* Pistil */}
      <line x1={24} y1={44} x2={24} y2={33} stroke={MOON_C.vein} strokeWidth={1} />
      <circle cx={24} cy={32} r={2} fill={MOON_C.vein} />
    </g>
  );
}

function MoonflowerBud() {
  return (
    <g>
      <path d="M24,100 L24,56" stroke={MOON_C.stem} strokeWidth={1.5} strokeLinecap="round" />
      <path d="M24,86 C14,80 8,74 6,66 C10,60 18,64 22,72 Z" fill={MOON_C.stem} />
      <path d="M24,56 C20,50 16,42 18,34 C19,28 29,28 30,34 C32,42 28,50 24,56 Z" fill={MOON_C.petal} opacity={0.82} />
    </g>
  );
}

/* ─── Lavender ──────────────────────────────────────── */
const LAVEN_BUDS: Array<[number, number, number, number]> = [
  [24, 14, 3, 4.2],
  [21, 20, 2.6, 3.8], [27, 20, 2.6, 3.8],
  [20, 26, 2.6, 3.8], [28, 26, 2.6, 3.8],
  [21, 32, 2.4, 3.5], [27, 32, 2.4, 3.5],
  [20, 38, 2.4, 3.5], [28, 38, 2.4, 3.5],
  [21, 44, 2.2, 3.2], [27, 44, 2.2, 3.2],
  [22, 50, 2.2, 3.2], [26, 50, 2.2, 3.2],
];
const LAVEN_SIDE_L: Array<[number, number, number, number]> = [
  [19, 26, 2, 2.8], [18, 32, 2, 2.8], [19, 38, 2, 2.8], [18, 44, 2, 2.8],
];
const LAVEN_SIDE_R: Array<[number, number, number, number]> = [
  [29, 26, 2, 2.8], [30, 32, 2, 2.8], [29, 38, 2, 2.8], [30, 44, 2, 2.8],
];

function LavenderBloom() {
  return (
    <g>
      {/* Stems */}
      <path d="M24,100 L24,56" stroke={LAVEN_C.stem} strokeWidth={1.3} strokeLinecap="round" />
      <path d="M24,80 C20,72 18,62 20,54" stroke={LAVEN_C.stem} strokeWidth={1} strokeLinecap="round" fill="none" />
      <path d="M24,80 C28,72 30,62 28,54" stroke={LAVEN_C.stem} strokeWidth={1} strokeLinecap="round" fill="none" />
      {/* Narrow leaves */}
      <path d="M24,92 C18,90 12,87 10,82" stroke={LAVEN_C.stem} strokeWidth={0.9} strokeLinecap="round" fill="none" />
      <path d="M24,88 C30,86 36,83 38,78" stroke={LAVEN_C.stem} strokeWidth={0.9} strokeLinecap="round" fill="none" />
      {/* Main spike buds */}
      {LAVEN_BUDS.map(([cx, cy, rx, ry], i) => (
        <ellipse key={i} cx={cx} cy={cy} rx={rx} ry={ry} fill={LAVEN_C.bud} />
      ))}
      {/* Side branch buds */}
      {LAVEN_SIDE_L.map(([cx, cy, rx, ry], i) => (
        <ellipse key={i} cx={cx} cy={cy} rx={rx} ry={ry} fill={LAVEN_C.bud} opacity={0.8} />
      ))}
      {LAVEN_SIDE_R.map(([cx, cy, rx, ry], i) => (
        <ellipse key={i} cx={cx} cy={cy} rx={rx} ry={ry} fill={LAVEN_C.bud} opacity={0.8} />
      ))}
    </g>
  );
}

function LavenderBud() {
  return (
    <g>
      <path d="M24,100 L24,58" stroke={LAVEN_C.stem} strokeWidth={1.3} strokeLinecap="round" />
      <path d="M24,82 C18,76 14,70 12,62" stroke={LAVEN_C.stem} strokeWidth={0.9} strokeLinecap="round" fill="none" />
      {[14, 20, 26, 32, 38].map((y, i) => (
        <ellipse key={i} cx={24} cy={y + 20} rx={2.5} ry={3.5} fill={LAVEN_C.bud} opacity={0.65} />
      ))}
    </g>
  );
}

/* ─── Poppy ─────────────────────────────────────────── */
function PoppyBloom() {
  return (
    <g>
      <path d="M24,100 L24,62" stroke={POPPY_C.stem} strokeWidth={1.5} strokeLinecap="round" />
      {/* Hairs */}
      <path d="M24,76 L21,72" stroke={POPPY_C.stem} strokeWidth={0.7} strokeLinecap="round" />
      <path d="M24,70 L27,66" stroke={POPPY_C.stem} strokeWidth={0.7} strokeLinecap="round" />
      <path d="M24,84 L21,80" stroke={POPPY_C.stem} strokeWidth={0.7} strokeLinecap="round" />
      {/* Feathery leaf */}
      <path d="M24,82 C14,76 8,70 8,62 C12,56 20,60 22,68 Z" fill={POPPY_C.stem} opacity={0.8} />
      {/* 4 wide petals */}
      {/* Top */}
      <path d="M24,48 C22,42 16,28 20,18 C22,12 28,14 26,24 C25,34 24,42 24,48 Z" fill={POPPY_C.petal} opacity={0.95} />
      {/* Right */}
      <path d="M26,48 C32,44 44,36 46,26 C46,18 38,18 34,28 C30,36 28,44 26,48 Z" fill={POPPY_C.petal} opacity={0.95} />
      {/* Bottom */}
      <path d="M24,52 C22,58 16,70 20,78 C22,82 28,80 26,72 C25,64 24,58 24,52 Z" fill={POPPY_C.petal} opacity={0.9} />
      {/* Left */}
      <path d="M22,48 C16,44 4,36 2,26 C2,18 10,18 14,28 C18,36 20,44 22,48 Z" fill={POPPY_C.petal} opacity={0.95} />
      {/* Seed head */}
      <circle cx={24} cy={48} r={10} fill={POPPY_C.dark} />
      <circle cx={24} cy={48} r={7} fill={POPPY_C.mid} />
      {/* Radial ribs on seed head */}
      {[0, 60, 120, 180, 240, 300].map((a) => (
        <line key={a} x1={24} y1={41} x2={24} y2={43.5} stroke="#6C6A82" strokeWidth={0.8} transform={`rotate(${a} 24 48)`} />
      ))}
      {/* Stamens */}
      {[[22,44],[26,44],[28,47],[20,47],[22,51],[26,51]].map(([cx,cy],i) => (
        <circle key={i} cx={cx} cy={cy} r={1.2} fill={POPPY_C.stamen} opacity={0.7} />
      ))}
    </g>
  );
}

function PoppyBud() {
  return (
    <g>
      <path d="M24,100 L24,54" stroke={POPPY_C.stem} strokeWidth={1.5} strokeLinecap="round" />
      <path d="M24,80 C14,74 8,68 8,60 C12,54 20,58 22,66 Z" fill={POPPY_C.stem} opacity={0.8} />
      <path d="M24,54 C20,48 16,38 19,30 C20,24 28,24 29,30 C32,38 28,48 24,54 Z" fill={POPPY_C.petal} opacity={0.88} />
      {/* Hairy sepals */}
      <path d="M21,55 L18,47" stroke={POPPY_C.stem} strokeWidth={0.9} strokeLinecap="round" opacity={0.7} />
      <path d="M24,56 L24,48" stroke={POPPY_C.stem} strokeWidth={0.9} strokeLinecap="round" opacity={0.7} />
      <path d="M27,55 L30,47" stroke={POPPY_C.stem} strokeWidth={0.9} strokeLinecap="round" opacity={0.7} />
    </g>
  );
}

/* ─── Generic bud seed ──────────────────────────────── */
const SPECIES_COLORS: Record<FlowerSpecies, string> = {
  iris: IRIS_C.fall,
  rose: ROSE_C.outer,
  moonflower: MOON_C.petal,
  lavender: LAVEN_C.bud,
  poppy: POPPY_C.petal,
};

function GenericSeed({ species }: { species: FlowerSpecies }) {
  return (
    <ellipse cx={24} cy={98} rx={2.5} ry={1.8} fill={SPECIES_COLORS[species]} opacity={0.45} />
  );
}

function ExpiredBud({ species }: { species: FlowerSpecies }) {
  const color = SPECIES_COLORS[species];
  return (
    <g opacity={0.32}>
      {/* Drooped stem */}
      <path d="M24,100 L24,62 C24,58 25,55 27,52" stroke="#6FA887" strokeWidth={1.4} strokeLinecap="round" fill="none" />
      {/* Wilted bud, slightly bent */}
      <path d="M27,52 C26,47 24,42 26,36 C27,32 31,34 30,40 C29,46 27,50 27,52 Z" fill={color} opacity={0.75} />
    </g>
  );
}

/* ─── Main Flower component ─────────────────────────── */
export function Flower({ species, stage, isFirstReading, onClick }: FlowerProps) {
  const bloom = stage === "bloom";
  const isExpired = stage === "expired";
  const isSeed = stage === "seed";

  const inner = (() => {
    if (isSeed) return <GenericSeed species={species} />;
    if (isExpired) return <ExpiredBud species={species} />;

    switch (species) {
      case "iris":
        return bloom ? <IrisBloom gold={isFirstReading} /> : <IrisBud />;
      case "rose":
        return bloom ? <RoseBloom /> : <RoseBud />;
      case "moonflower":
        return bloom ? <MoonflowerBloom /> : <MoonflowerBud />;
      case "lavender":
        return bloom ? <LavenderBloom /> : <LavenderBud />;
      case "poppy":
        return bloom ? <PoppyBloom /> : <PoppyBud />;
    }
  })();

  return (
    <motion.button
      onClick={onClick}
      className="focus:outline-none cursor-pointer"
      aria-label={`${species} — ${stage}`}
      whileHover={onClick ? { scale: 1.06 } : {}}
      transition={{ duration: 0.3, ease: [0.25, 0, 0.5, 1] }}
      animate={
        bloom
          ? { opacity: [0.85, 1, 0.85] }
          : {}
      }
    >
      <svg
        width={48}
        height={100}
        viewBox="0 0 48 100"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden
        style={{ overflow: "visible" }}
      >
        {inner}
      </svg>
    </motion.button>
  );
}
