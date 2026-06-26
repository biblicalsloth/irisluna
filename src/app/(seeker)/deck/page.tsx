"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { DeckSpread } from "@/components/deck/DeckSpread";
import { useFlowStore } from "@/lib/flow/store";
import type { SpreadType } from "@/lib/supabase/types";

export default function DeckPage() {
  const router = useRouter();
  const blob = useFlowStore((s) => s.blob);
  const setSpreadType = useFlowStore((s) => s.setSpreadType);
  const setPositions = useFlowStore((s) => s.setPositions);
  const spreadType = useFlowStore((s) => s.spreadType);

  const [chosen, setChosen] = useState<SpreadType | null>(spreadType);

  // Guard: if no blob, send back to ask
  useEffect(() => {
    if (!blob) router.replace("/ask");
  }, [blob, router]);

  function handleSpreadChoice(type: SpreadType) {
    setSpreadType(type);
    setChosen(type);
  }

  function handleConfirm(positions: number[]) {
    setPositions(positions);
    router.push("/auth");
  }

  if (!blob) return null;

  return (
    <main className="flex flex-col min-h-dvh">
      {/* Header — one whispered line */}
      <motion.header
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.7, ease: "easeOut" }}
        className="pt-10 pb-2 text-center px-6"
      >
        <p className="font-display italic text-moonlight/50 text-sm tracking-wide">
          {chosen ? "draw your cards" : "choose your spread"}
        </p>
      </motion.header>

      {/* Spread selector */}
      <AnimatePresence>
        {!chosen && (
          <motion.div
            key="spread-selector"
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -12 }}
            transition={{ duration: 0.45, delay: 0.15 }}
            className="flex-1 flex flex-col items-center justify-center gap-5 px-6"
          >
            <SpreadOption
              label="single"
              sub="one card, one truth"
              onClick={() => handleSpreadChoice("single")}
            />
            <SpreadOption
              label="three cards"
              sub="past · present · future"
              onClick={() => handleSpreadChoice("three")}
            />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Deck fan — shown after spread chosen */}
      <AnimatePresence>
        {chosen && (
          <motion.div
            key="deck"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.55, delay: 0.05 }}
            className="flex-1 flex items-center justify-center px-6 py-8"
          >
            <DeckSpread spreadType={chosen} onConfirm={handleConfirm} />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Bottom nav */}
      <motion.nav
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.5, duration: 0.5 }}
        className="flex items-center px-6 pb-8 pt-4"
      >
        <button
          onClick={() => {
            if (chosen) {
              setChosen(null);
              setSpreadType(null as unknown as SpreadType);
            } else {
              router.push("/ask");
            }
          }}
          className="text-muted text-[11px] uppercase tracking-[0.14em] hover:text-moonlight/60 transition-colors cursor-pointer"
        >
          ← back
        </button>
      </motion.nav>
    </main>
  );
}

function SpreadOption({
  label,
  sub,
  onClick,
}: {
  label: string;
  sub: string;
  onClick: () => void;
}) {
  return (
    <motion.button
      onClick={onClick}
      whileHover={{ scale: 1.02 }}
      whileTap={{ scale: 0.98 }}
      className="group w-full max-w-xs flex flex-col items-center gap-1.5 py-5 px-8 rounded-xl border border-iris-500/15 hover:border-iris-500/35 transition-colors duration-400 cursor-pointer"
      style={{ background: "rgba(124,111,203,0.04)" }}
    >
      <span className="text-moonlight/80 text-sm tracking-[0.06em] font-sans group-hover:text-moonlight transition-colors duration-300">
        {label}
      </span>
      <span className="text-muted text-[11px] tracking-[0.1em]">{sub}</span>
    </motion.button>
  );
}
