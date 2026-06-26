"use client";

import { useMemo } from "react";
import { motion } from "framer-motion";
import { Flower } from "./Flower";
import type { FlowerData } from "@/types/garden";

interface GardenProps {
  flowers: FlowerData[];
  seed: number;
  onFlowerClick?: (flower: FlowerData) => void;
}

function mulberry32(seed: number) {
  let s = (seed + 1) >>> 0;
  return () => {
    s += 0x6D2B79F5;
    s >>>= 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 0xFFFFFFFF;
  };
}

interface ResolvedFlower extends FlowerData {
  zIndex: number;
}

function resolvePositions(flowers: FlowerData[], seed: number): ResolvedFlower[] {
  if (flowers.length === 0) return [];
  const rng = mulberry32(seed);
  return flowers.map((f) => {
    // Reserve positions already stored in xNorm / yNorm; just derive z from yNorm
    void rng(); // consume deterministic slot even if not used
    return {
      ...f,
      zIndex: Math.round(f.yNorm * 10),
    };
  });
}

export function Garden({ flowers, seed, onFlowerClick }: GardenProps) {
  const resolved = useMemo(() => resolvePositions(flowers, seed), [flowers, seed]);
  const isEmpty = flowers.length === 0;

  return (
    <section
      className="relative flex-1 w-full overflow-hidden"
      style={{ minHeight: "52vh" }}
      aria-label="Your garden"
    >

      {/* Horizon line — 1px barely-there */}
      <div
        className="absolute inset-x-0 pointer-events-none"
        aria-hidden
        style={{
          bottom: "37.5%",
          height: 1,
          background:
            "linear-gradient(to right, transparent 0%, rgba(183,174,234,0.07) 20%, rgba(183,174,234,0.12) 50%, rgba(183,174,234,0.07) 80%, transparent 100%)",
        }}
      />

      {/* Empty state hint — only shown on first view before any readings */}
      {isEmpty && (
        <motion.div
          className="absolute inset-x-0 flex flex-col items-center pointer-events-none"
          style={{ bottom: "40%" }}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 1.4, duration: 1.2, ease: "easeOut" }}
          aria-hidden
        >
          {/* Three seed silhouettes, barely visible */}
          <div className="flex gap-10 items-end">
            {[{ h: 6, o: 0.12 }, { h: 9, o: 0.16 }, { h: 5, o: 0.11 }].map((s, i) => (
              <div
                key={i}
                style={{
                  width: 2,
                  height: s.h,
                  borderRadius: 1,
                  background: `rgba(183,174,234,${s.o})`,
                }}
              />
            ))}
          </div>
        </motion.div>
      )}

      {/* Flowers */}
      {resolved.map((f) => (
        <motion.div
          key={f.id}
          className="absolute"
          style={{
            left: `${f.xNorm * 100}%`,
            bottom: `${f.yNorm * 38}%`,
            transform: `translateX(-50%) rotate(${f.lean}rad) scale(${f.scale})`,
            transformOrigin: "50% 100%",
            zIndex: f.zIndex,
          }}
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
        >
          <Flower
            species={f.species}
            stage={f.stage}
            isFirstReading={f.isFirstReading}
            onClick={onFlowerClick ? () => onFlowerClick(f) : undefined}
          />
        </motion.div>
      ))}
    </section>
  );
}
