"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Card } from "./Card";
import type { SpreadType } from "@/lib/supabase/types";

const SPREAD_CARD_COUNTS = { single: 7, three: 9 };
const SPREAD_PICK_COUNTS = { single: 1, three: 3 };
const POSITION_LABELS = { single: [""], three: ["past", "present", "future"] };

interface DeckSpreadProps {
  spreadType: SpreadType;
  onConfirm: (positions: number[]) => void;
}

interface SelectedCard {
  cardIndex: number;
  slotIndex: number;
}

export function DeckSpread({ spreadType, onConfirm }: DeckSpreadProps) {
  const [selected, setSelected] = useState<SelectedCard[]>([]);
  const totalCards = SPREAD_CARD_COUNTS[spreadType];
  const pickCount = SPREAD_PICK_COUNTS[spreadType];
  const slots = Array.from({ length: pickCount });

  const handleCardClick = (cardIndex: number) => {
    const alreadySelected = selected.find((s) => s.cardIndex === cardIndex);
    if (alreadySelected) {
      // Deselect
      setSelected((prev) => prev.filter((s) => s.cardIndex !== cardIndex));
      return;
    }
    if (selected.length >= pickCount) return;
    const slotIndex = selected.length;
    setSelected((prev) => [...prev, { cardIndex, slotIndex }]);
  };

  const selectedCardIndices = new Set(selected.map((s) => s.cardIndex));
  const allFilled = selected.length === pickCount;

  return (
    <div className="flex flex-col items-center gap-10">
      {/* Fan */}
      <div
        className="relative"
        style={{ width: 280, height: 160 }}
        role="group"
        aria-label="Choose your cards"
      >
        {Array.from({ length: totalCards }).map((_, i) => {
          const isSelected = selectedCardIndices.has(i);
          const isDisabled = !isSelected && selected.length >= pickCount;
          return (
            <div
              key={i}
              className="absolute"
              style={{ left: "50%", bottom: 0, transform: "translateX(-50%)" }}
            >
              <Card
                index={i}
                total={totalCards}
                isSelected={isSelected}
                isDisabled={isDisabled}
                onClick={() => handleCardClick(i)}
              />
            </div>
          );
        })}
      </div>

      {/* Slots */}
      <div className="flex gap-4 items-end">
        {slots.map((_, slotIdx) => {
          const filled = selected.find((s) => s.slotIndex === slotIdx);
          const label = POSITION_LABELS[spreadType][slotIdx];
          return (
            <div key={slotIdx} className="flex flex-col items-center gap-2">
              <motion.div
                animate={{
                  borderColor: filled ? "rgba(183,174,234,0.45)" : "rgba(124,111,203,0.2)",
                  background: filled ? "rgba(124,111,203,0.08)" : "transparent",
                }}
                transition={{ duration: 0.35 }}
                style={{
                  width: 64,
                  height: 108,
                  borderRadius: 8,
                  border: "1px dashed",
                  borderColor: "rgba(124,111,203,0.2)",
                }}
              >
                {filled && (
                  <motion.div
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                    className="w-full h-full flex items-center justify-center"
                  >
                    <svg width={20} height={20} viewBox="0 0 20 20" aria-hidden>
                      <circle cx={10} cy={10} r={7} fill="none" stroke="#B7AEEA" strokeWidth={1} opacity={0.4} />
                      <circle cx={10} cy={10} r={2} fill="#B7AEEA" opacity={0.5} />
                    </svg>
                  </motion.div>
                )}
              </motion.div>
              {label && (
                <span className="text-muted text-[10px] uppercase tracking-[0.14em]">
                  {label}
                </span>
              )}
            </div>
          );
        })}
      </div>

      {/* Instruction / Confirm */}
      <AnimatePresence mode="wait">
        {!allFilled ? (
          <motion.p
            key="instruction"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="text-muted text-[11px] uppercase tracking-[0.14em]"
          >
            {selected.length === 0
              ? `choose ${pickCount === 1 ? "a card" : `${pickCount} cards`}`
              : `${pickCount - selected.length} more`}
          </motion.p>
        ) : (
          <motion.button
            key="confirm"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            transition={{ duration: 0.4 }}
            onClick={() => onConfirm(selected.map((s) => s.slotIndex))}
            className="text-[11px] uppercase tracking-[0.16em] text-moonlight/80 border border-iris-500/30 rounded-full px-6 py-2.5 hover:border-iris-500/60 hover:text-moonlight transition-colors duration-300 cursor-pointer"
          >
            these are my cards
          </motion.button>
        )}
      </AnimatePresence>
    </div>
  );
}
