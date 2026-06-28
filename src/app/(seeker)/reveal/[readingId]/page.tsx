"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import Link from "next/link";
import { getStoredReadings, updateReadingStatus } from "@/lib/session";
import type { StoredReading } from "@/lib/session";
import { RevealCard } from "@/components/deck/RevealCard";
import type { CardRevealData } from "@/components/deck/RevealCard";
import { WavePlayer } from "@/components/audio/WavePlayer";

const POSITION_LABELS: Record<string, string[]> = {
  single: [""],
  three: ["past", "present", "future"],
};

// Placeholder cards until Supabase reading_cards join is wired
const PLACEHOLDER_CARDS: CardRevealData[] = [
  {
    id: 0,
    name: "The Fool",
    arcana: "major",
    upright_meaning:
      "New beginnings, innocence, spontaneity, a free spirit. The Fool represents a leap of faith and openness to experience.",
    reversed_meaning:
      "Holding back, recklessness, risk-taking. A warning to look before you leap.",
    keywords: ["beginnings", "freedom", "innocence"],
  },
  {
    id: 2,
    name: "The High Priestess",
    arcana: "major",
    upright_meaning:
      "Intuition, sacred knowledge, divine feminine, the subconscious. She asks you to look inward.",
    reversed_meaning:
      "Secrets, disconnected from intuition, withdrawal. Hidden agendas are at play.",
    keywords: ["intuition", "mystery", "inner voice"],
  },
  {
    id: 17,
    name: "The Star",
    arcana: "major",
    upright_meaning:
      "Hope, faith, renewal, inspiration. After the storm comes calm clarity and the sense that things will be well.",
    reversed_meaning:
      "Lack of faith, despair, self-trust issues. The light is still there — turn toward it.",
    keywords: ["hope", "renewal", "faith"],
  },
];

type FetchState =
  | { phase: "loading" }
  | { phase: "ready"; cards: CardRevealData[]; responseAudioUrl: string | null }
  | { phase: "error" };

export default function RevealPage() {
  const { readingId } = useParams<{ readingId: string }>();
  const [reading, setReading] = useState<StoredReading | "not_found" | null>(null);
  const [fetchState, setFetchState] = useState<FetchState>({ phase: "loading" });
  const [flippedCount, setFlippedCount] = useState(0);
  const [allFlipped, setAllFlipped] = useState(false);

  useEffect(() => {
    const found = getStoredReadings().find((r) => r.readingId === readingId);
    setReading(found ?? "not_found");
  }, [readingId]);

  // Mark revealed in localStorage once
  useEffect(() => {
    if (!reading || reading === "not_found") return;
    if (reading.status !== "revealed") {
      updateReadingStatus(readingId, "revealed", "bloom");
    }
  }, [reading, readingId]);

  // Fetch card assignments + signed audio URL from reveal_reading edge function
  useEffect(() => {
    if (!reading || reading === "not_found") return;

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    if (!supabaseUrl) {
      // Dev fallback: use placeholder cards
      const count = reading.spreadType === "single" ? 1 : 3;
      const labels = POSITION_LABELS[reading.spreadType] ?? [];
      const cards = PLACEHOLDER_CARDS.slice(0, count).map((c, i) => ({
        ...c,
        positionLabel: labels[i] ?? undefined,
        reversed: false,
      }));
      setFetchState({ phase: "ready", cards, responseAudioUrl: null });
      return;
    }

    fetch(`${supabaseUrl}/functions/v1/reveal_reading`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? ""}`,
      },
      body: JSON.stringify({
        reading_id: readingId,
        session_token: reading.sessionToken,
      }),
    })
      .then((r) => r.json())
      .then((data: {
        spread_type: string;
        cards: Array<{
          position: number;
          is_reversed: boolean;
          id: number;
          name: string;
          arcana: "major" | "minor";
          suit?: string;
          number?: number;
          upright_meaning: string;
          reversed_meaning: string;
          keywords: string[];
          image_path?: string;
        }>;
        response_audio_url: string | null;
      }) => {
        const labels = POSITION_LABELS[reading.spreadType] ?? [];
        const cards: CardRevealData[] = data.cards.map((c) => ({
          id: c.id,
          name: c.name,
          arcana: c.arcana,
          suit: c.suit,
          number: c.number,
          upright_meaning: c.upright_meaning,
          reversed_meaning: c.reversed_meaning,
          keywords: c.keywords ?? [],
          image_path: c.image_path,
          positionLabel: labels[c.position] ?? undefined,
          reversed: c.is_reversed,
        }));
        setFetchState({ phase: "ready", cards, responseAudioUrl: data.response_audio_url });
      })
      .catch((err) => {
        console.error("reveal_reading error:", err);
        setFetchState({ phase: "error" });
      });
  }, [reading, readingId]);

  function handleCardFlipped() {
    setFlippedCount((n) => {
      const next = n + 1;
      if (fetchState.phase === "ready" && next >= fetchState.cards.length) {
        setTimeout(() => setAllFlipped(true), 400);
      }
      return next;
    });
  }

  if (reading === null) return null;

  if (reading === "not_found") {
    return (
      <main className="flex flex-col items-center justify-center min-h-dvh p-8 text-center">
        <p className="font-display italic text-moonlight/50 text-lg mb-3">nothing here</p>
        <p className="text-muted text-sm mb-8">
          This reading doesn't belong to this device.
        </p>
        <Link
          href="/"
          className="text-muted/60 text-xs uppercase tracking-[0.18em] hover:text-muted transition-colors"
        >
          ← return
        </Link>
      </main>
    );
  }

  if (fetchState.phase === "error") {
    return (
      <main className="flex flex-col items-center justify-center min-h-dvh p-8 text-center">
        <p className="font-display italic text-moonlight/50 text-lg mb-3">something went wrong</p>
        <p className="text-muted text-sm mb-8">Could not load your reading. Try again.</p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="text-iris-300/60 text-xs uppercase tracking-[0.18em] hover:text-iris-300 transition-colors"
        >
          retry
        </button>
      </main>
    );
  }

  return (
    <main className="relative flex flex-col items-center min-h-dvh overflow-hidden px-6 pt-14 pb-20">
      {/* Soft purple glow */}
      <div
        aria-hidden
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            "radial-gradient(ellipse 70% 45% at 50% 30%, oklch(0.52 0.118 283 / 0.07) 0%, transparent 70%)",
        }}
      />

      {/* Header */}
      <motion.div
        className="w-full max-w-sm flex flex-col items-center mb-12"
        initial={{ opacity: 0, y: -6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.8 }}
      >
        <span
          className="font-display italic text-moonlight/60 tracking-tight"
          style={{ fontSize: 18 }}
        >
          iris luna
        </span>
        <p className="text-muted text-[10px] uppercase tracking-[0.2em] mt-1">
          your reading
        </p>
      </motion.div>

      {/* Cards */}
      {fetchState.phase === "ready" && (
        <motion.div
          className="flex items-start justify-center gap-6 mb-16"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.3, duration: 0.6 }}
        >
          {fetchState.cards.map((card, i) => (
            <RevealCard
              key={card.id}
              card={card}
              delay={0.2 + i * 0.25}
              onFlipped={handleCardFlipped}
            />
          ))}
        </motion.div>
      )}

      {/* Audio player + garden link — revealed after all cards flipped */}
      <AnimatePresence>
        {allFlipped && (
          <motion.div
            className="w-full max-w-sm"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.8, ease: "easeOut" }}
          >
            {fetchState.phase === "ready" && fetchState.responseAudioUrl ? (
              <div
                className="rounded-lg p-5"
                style={{ border: "1px solid rgba(124,111,203,0.16)" }}
              >
                <WavePlayer
                  src={fetchState.responseAudioUrl}
                  label="the human speaks"
                />
              </div>
            ) : (
              <div className="text-center">
                <p className="font-display italic text-moonlight/55 text-base mb-2">
                  the reading is yours
                </p>
                <p className="text-muted text-sm leading-relaxed">
                  Sit with what the cards have shown you.
                </p>
              </div>
            )}

            <motion.div
              className="flex justify-center mt-10"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.6, duration: 0.7 }}
            >
              <Link
                href="/"
                className="text-muted/50 text-[10px] uppercase tracking-[0.2em] hover:text-muted/80 transition-colors"
              >
                ← return to the garden
              </Link>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Pre-flip hint */}
      <AnimatePresence>
        {fetchState.phase === "ready" && flippedCount === 0 && (
          <motion.p
            className="text-muted/40 text-[10px] uppercase tracking-[0.18em] absolute bottom-10"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ delay: 1.4, duration: 0.7 }}
          >
            {fetchState.cards.length === 1 ? "tap to reveal" : "tap each card to reveal"}
          </motion.p>
        )}
      </AnimatePresence>
    </main>
  );
}
