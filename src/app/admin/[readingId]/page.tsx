"use client";

import { use, useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import { createClient } from "@/lib/supabase/client";
import { WavePlayer } from "@/components/audio/WavePlayer";
import { HoldToRecord } from "@/components/audio/HoldToRecord";
import type { ReadingStatus } from "@/lib/supabase/types";

interface Reading {
  id: string;
  status: ReadingStatus;
  spread_type: "single" | "three";
  created_at: string;
  email: string | null;
  question_audio_path: string;
  question_duration_ms: number | null;
  payment_screenshot_path: string;
  payment_verified_at: string | null;
  response_audio_path: string | null;
  claimed_by: string | null;
  claimed_at: string | null;
}

interface AssignedCard {
  position: number;
  is_reversed: boolean;
  card_id: number;
  name: string;
  arcana: string;
  suit: string | null;
  upright_meaning: string;
  reversed_meaning: string;
  keywords: string[] | null;
}

const POSITION_LABELS: Record<string, string[]> = {
  single: [""],
  three: ["past", "present", "future"],
};

type ViewState =
  | { phase: "loading" }
  | {
      phase: "ready";
      reading: Reading;
      screenshotUrl: string | null;
      questionAudioUrl: string | null;
      cards: AssignedCard[];
    }
  | { phase: "error"; message: string };

export default function AdminReadingPage({
  params,
}: {
  params: Promise<{ readingId: string }>;
}) {
  const { readingId } = use(params);
  const [view, setView] = useState<ViewState>({ phase: "loading" });
  const [actioning, setActioning] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);

  // Response recording state
  const [responseBlob, setResponseBlob] = useState<Blob | null>(null);
  const [responseMime, setResponseMime] = useState("");
  const [responseMs, setResponseMs] = useState(0);
  const [submittingResponse, setSubmittingResponse] = useState(false);

  const supabase = createClient();

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setCurrentUserId(session?.user?.id ?? null);
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from("readings")
      .select(
        "id, status, spread_type, created_at, email, question_audio_path, question_duration_ms, payment_screenshot_path, payment_verified_at, response_audio_path, claimed_by, claimed_at"
      )
      .eq("id", readingId)
      .single();

    if (error || !data) {
      setView({ phase: "error", message: "Reading not found." });
      return;
    }

    const reading = data as Reading;

    // Generate signed URLs + fetch assigned cards in parallel
    const [screenshotResult, audioResult, rcResult] = await Promise.all([
      supabase.storage.from("payment-screenshots").createSignedUrl(reading.payment_screenshot_path, 3600),
      supabase.storage.from("question-audio").createSignedUrl(reading.question_audio_path, 3600),
      supabase
        .from("reading_cards")
        .select("*")
        .eq("reading_id", readingId)
        .order("position"),
    ]);

    // Fetch card details for each assigned card
    type RcRow = { position: number; is_reversed: boolean; card_id: number };
    const rcRows = ((rcResult.data ?? []) as unknown as RcRow[]);
    const cardIds = rcRows.map((rc) => rc.card_id);

    type CardRow = { id: number; name: string; arcana: string; suit: string | null; upright_meaning: string; reversed_meaning: string; keywords: string[] | null };
    let cardRows: CardRow[] = [];
    if (cardIds.length) {
      const { data } = await supabase.from("cards").select("id, name, arcana, suit, upright_meaning, reversed_meaning, keywords").in("id", cardIds);
      cardRows = (data ?? []) as unknown as CardRow[];
    }

    const cardMap = new Map(cardRows.map((c) => [c.id, c]));

    const cards: AssignedCard[] = rcRows.map((rc) => {
      const card = cardMap.get(rc.card_id);
      return {
        position: rc.position,
        is_reversed: rc.is_reversed,
        card_id: rc.card_id,
        name: card?.name ?? "Unknown",
        arcana: card?.arcana ?? "major",
        suit: card?.suit ?? null,
        upright_meaning: card?.upright_meaning ?? "",
        reversed_meaning: card?.reversed_meaning ?? "",
        keywords: card?.keywords ?? null,
      };
    });

    setView({
      phase: "ready",
      reading,
      screenshotUrl: screenshotResult.data?.signedUrl ?? null,
      questionAudioUrl: audioResult.data?.signedUrl ?? null,
      cards,
    });
  }, [readingId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { void load(); }, [load]);

  async function handleVerify(action: "verify" | "reject") {
    if (view.phase !== "ready") return;
    setActioning(true);
    setActionError(null);

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const { data: { session } } = await supabase.auth.getSession();

    if (!supabaseUrl || !session) {
      setActionError("Not authenticated.");
      setActioning(false);
      return;
    }

    try {
      const res = await fetch(`${supabaseUrl}/functions/v1/verify_payment`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ reading_id: readingId, action }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(err.error ?? "Action failed");
      }

      await load();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setActioning(false);
    }
  }

  async function handleClaim() {
    if (view.phase !== "ready" || !currentUserId) return;
    setActioning(true);
    setActionError(null);
    try {
      const { error } = await supabase
        .from("readings")
        .update({ claimed_by: currentUserId, claimed_at: new Date().toISOString() } as never)
        .eq("id", readingId)
        .is("claimed_by", null); // only claim if unclaimed (optimistic lock)
      if (error) throw new Error("Claim failed: " + error.message);
      await load();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setActioning(false);
    }
  }

  async function handleSubmitResponse() {
    if (!responseBlob || view.phase !== "ready") return;
    setSubmittingResponse(true);
    setActionError(null);

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const { data: { session } } = await supabase.auth.getSession();

    if (!supabaseUrl || !session) {
      setActionError("Not authenticated.");
      setSubmittingResponse(false);
      return;
    }

    try {
      const ext = responseMime.includes("mp4") ? "mp4" : "webm";
      const audioPath = `${readingId}-response.${ext}`;

      // Upload to response-audio bucket (reader has insert policy)
      const { error: uploadErr } = await supabase.storage
        .from("response-audio")
        .upload(audioPath, responseBlob, {
          contentType: responseMime,
          upsert: true,
        });

      if (uploadErr) throw new Error("Upload failed: " + uploadErr.message);

      // Call submit_response edge function
      const res = await fetch(`${supabaseUrl}/functions/v1/submit_response`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          reading_id: readingId,
          response_audio_path: audioPath,
          response_duration_ms: responseMs,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(err.error ?? "Submit failed");
      }

      await load();
      setResponseBlob(null);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setSubmittingResponse(false);
    }
  }

  if (view.phase === "loading") {
    return (
      <main className="flex flex-col min-h-dvh px-6 pt-10 max-w-2xl mx-auto">
        <div className="animate-pulse flex flex-col gap-4 mt-16">
          {[80, 160, 120].map((h, i) => (
            <div
              key={i}
              className="rounded-lg"
              style={{ height: h, background: "oklch(0.07 0.018 281 / 0.6)" }}
            />
          ))}
        </div>
      </main>
    );
  }

  if (view.phase === "error") {
    return (
      <main className="flex flex-col items-center justify-center min-h-dvh p-8 text-center">
        <p className="text-muted text-sm mb-6">{view.message}</p>
        <Link href="/admin" className="text-muted/50 text-xs uppercase tracking-[0.14em] hover:text-muted transition-colors">
          ← back
        </Link>
      </main>
    );
  }

  const { reading, screenshotUrl, questionAudioUrl } = view;

  return (
    <main className="flex flex-col min-h-dvh px-6 pt-10 pb-20 max-w-2xl mx-auto">
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: -4 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.7 }}
        className="mb-8"
      >
        <div className="flex items-center gap-3 mb-1">
          <Link
            href="/admin"
            className="text-muted/50 text-[10px] uppercase tracking-[0.14em] hover:text-muted transition-colors"
          >
            ← queue
          </Link>
        </div>
        <span
          className="font-display italic tracking-tight leading-none"
          style={{ fontSize: 20, color: "oklch(0.94 0.018 301 / 0.7)" }}
        >
          iris luna · admin
        </span>
        <div className="flex items-center gap-3 mt-1">
          <p className="text-[10px] font-mono uppercase tracking-[0.12em]" style={{ color: "oklch(0.44 0.024 283)" }}>
            {reading.id.slice(0, 8)}
          </p>
          <StatusBadge status={reading.status} />
        </div>
        <p className="text-[10px] mt-0.5" style={{ color: "oklch(0.44 0.024 283 / 0.6)" }}>
          {reading.spread_type === "single" ? "1 card" : "3 cards"} · {new Date(reading.created_at).toLocaleString()}
          {reading.email && <> · {reading.email}</>}
        </p>
      </motion.div>

      {/* Error banner */}
      <AnimatePresence>
        {actionError && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="mb-4 px-4 py-3 rounded-lg text-sm"
            style={{
              background: "oklch(0.55 0.14 20 / 0.12)",
              color: "oklch(0.65 0.14 20)",
              border: "1px solid oklch(0.55 0.14 20 / 0.2)",
            }}
          >
            {actionError}
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Reader guidance ───────────────────────────────── */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.05, duration: 0.8 }}
        className="mb-6 px-4 py-3 rounded-lg text-[10px] leading-relaxed"
        style={{
          background: "oklch(0.52 0.118 283 / 0.07)",
          border: "1px solid oklch(0.52 0.118 283 / 0.12)",
          color: "oklch(0.44 0.024 283 / 0.9)",
        }}
      >
        Offer reflection, not advice. You are not a therapist, doctor, or crisis counsellor — be gentle, be present, and stay within that. If something in this reading raises concern, encourage the seeker to reach out to a professional.
      </motion.div>

      {/* ── Payment section ───────────────────────────────── */}
      <Section title="payment" delay={0.1}>
        {screenshotUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={screenshotUrl}
            alt="Payment screenshot"
            className="w-full rounded-md object-contain max-h-80 mb-4"
            style={{ background: "oklch(0.07 0.018 281 / 0.6)" }}
          />
        ) : (
          <div
            className="w-full h-40 rounded-md flex items-center justify-center mb-4"
            style={{ background: "oklch(0.07 0.018 281 / 0.6)" }}
          >
            <span className="text-muted/40 text-xs">screenshot unavailable</span>
          </div>
        )}

        {reading.status === "pending_payment" && (
          <div className="flex gap-3">
            <ActionButton
              onClick={() => handleVerify("verify")}
              disabled={actioning}
              color="green"
            >
              {actioning ? "…" : "verify"}
            </ActionButton>
            <ActionButton
              onClick={() => handleVerify("reject")}
              disabled={actioning}
              color="red"
            >
              reject
            </ActionButton>
          </div>
        )}

        {reading.status !== "pending_payment" && (
          <p className="text-[10px] uppercase tracking-[0.14em]" style={{ color: "oklch(0.44 0.024 283 / 0.6)" }}>
            {reading.payment_verified_at
              ? `Verified ${new Date(reading.payment_verified_at).toLocaleString()}`
              : "Not verified"}
          </p>
        )}
      </Section>

      {/* ── Question audio ─────────────────────────────────── */}
      {(reading.status === "awaiting_response" ||
        reading.status === "responded" ||
        reading.status === "revealed") && (
        <Section title="seeker's question" delay={0.2}>
          {questionAudioUrl ? (
            <WavePlayer src={questionAudioUrl} />
          ) : (
            <p className="text-muted/40 text-xs">Audio unavailable.</p>
          )}
        </Section>
      )}

      {/* ── Assigned cards (reader needs these to respond) ── */}
      {(reading.status === "awaiting_response" ||
        reading.status === "responded" ||
        reading.status === "revealed") &&
        view.phase === "ready" &&
        view.cards.length > 0 && (
        <Section title="cards" delay={0.25}>
          <div className="flex flex-col gap-3">
            {view.cards.map((card) => {
              const labels = POSITION_LABELS[reading.spread_type] ?? [];
              const label = labels[card.position];
              const meaning = card.is_reversed ? card.reversed_meaning : card.upright_meaning;
              return (
                <div
                  key={card.position}
                  className="rounded-md p-3"
                  style={{ background: "oklch(0.07 0.018 281 / 0.7)", border: "1px solid oklch(0.94 0.018 301 / 0.07)" }}
                >
                  <div className="flex items-baseline gap-2 mb-1">
                    {label && (
                      <span className="text-[9px] uppercase tracking-[0.15em]" style={{ color: "oklch(0.44 0.024 283 / 0.7)" }}>
                        {label}
                      </span>
                    )}
                    <span className="font-display italic text-sm" style={{ color: "oklch(0.94 0.018 301 / 0.8)" }}>
                      {card.name}
                    </span>
                    {card.is_reversed && (
                      <span className="text-[9px] uppercase tracking-[0.12em]" style={{ color: "oklch(0.79 0.099 82 / 0.65)" }}>
                        reversed
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] leading-relaxed" style={{ color: "oklch(0.44 0.024 283 / 0.9)" }}>
                    {meaning}
                  </p>
                  {card.keywords && card.keywords.length > 0 && (
                    <div className="flex gap-1.5 flex-wrap mt-2">
                      {card.keywords.slice(0, 4).map((kw) => (
                        <span
                          key={kw}
                          className="text-[9px] uppercase tracking-[0.1em] px-1.5 py-0.5 rounded"
                          style={{ background: "oklch(0.52 0.118 283 / 0.1)", color: "oklch(0.52 0.118 283 / 0.6)" }}
                        >
                          {kw}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </Section>
      )}

      {/* ── Claim ─────────────────────────────────────────── */}
      {reading.status === "awaiting_response" && (() => {
        const claimedByMe = reading.claimed_by === currentUserId;
        const claimedByOther = reading.claimed_by && reading.claimed_by !== currentUserId;
        if (claimedByOther) {
          return (
            <Section title="claimed" delay={0.28}>
              <p className="text-[11px]" style={{ color: "oklch(0.65 0.14 20 / 0.7)" }}>
                Another reader has claimed this reading. Wait for them to respond, or check back later.
              </p>
            </Section>
          );
        }
        if (!reading.claimed_by) {
          return (
            <Section title="claim" delay={0.28}>
              <p className="text-[11px] mb-3" style={{ color: "oklch(0.44 0.024 283 / 0.8)" }}>
                Claim this reading to let other readers know you're responding.
              </p>
              <ActionButton onClick={() => void handleClaim()} disabled={actioning} color="green">
                {actioning ? "…" : "claim reading"}
              </ActionButton>
            </Section>
          );
        }
        if (claimedByMe) {
          return (
            <Section title="claimed" delay={0.28}>
              <p className="text-[10px] uppercase tracking-[0.14em]" style={{ color: "oklch(0.62 0.104 163 / 0.7)" }}>
                ✓ claimed by you
                {reading.claimed_at && <> · {new Date(reading.claimed_at).toLocaleString()}</>}
              </p>
            </Section>
          );
        }
        return null;
      })()}

      {/* ── Record response ────────────────────────────────── */}
      {reading.status === "awaiting_response" && reading.claimed_by === currentUserId && (
        <Section title="record response" delay={0.3}>
          <div className="flex flex-col items-center gap-6">
            <HoldToRecord
              maxMs={180_000}
              onComplete={(blob, mime, ms) => {
                setResponseBlob(blob);
                setResponseMime(mime);
                setResponseMs(ms);
              }}
            />

            <AnimatePresence>
              {responseBlob && (
                <motion.div
                  className="w-full flex flex-col gap-3"
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.4 }}
                >
                  <p className="text-[10px] uppercase tracking-[0.14em] text-center" style={{ color: "oklch(0.44 0.024 283 / 0.7)" }}>
                    {(responseMs / 1000).toFixed(1)}s recorded
                  </p>
                  <button
                    type="button"
                    onClick={() => void handleSubmitResponse()}
                    disabled={submittingResponse}
                    className="w-full py-3 rounded-lg text-sm uppercase tracking-[0.18em] transition-all duration-300"
                    style={{
                      background: submittingResponse
                        ? "oklch(0.52 0.118 283 / 0.25)"
                        : "oklch(0.52 0.118 283)",
                      color: submittingResponse
                        ? "oklch(0.94 0.018 301 / 0.4)"
                        : "oklch(0.94 0.018 301)",
                      cursor: submittingResponse ? "not-allowed" : "pointer",
                    }}
                  >
                    {submittingResponse ? "sending…" : "send response"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setResponseBlob(null)}
                    disabled={submittingResponse}
                    className="text-muted/50 text-[10px] uppercase tracking-[0.14em] text-center hover:text-muted transition-colors"
                  >
                    record again
                  </button>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </Section>
      )}

      {/* ── Response sent ──────────────────────────────────── */}
      {(reading.status === "responded" || reading.status === "revealed") && (
        <Section title="response" delay={0.3}>
          <p className="text-[10px] uppercase tracking-[0.14em]" style={{ color: "oklch(0.62 0.104 163 / 0.7)" }}>
            ✓ response sent · seeker notified
          </p>
        </Section>
      )}
    </main>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function Section({
  title,
  delay = 0,
  children,
}: {
  title: string;
  delay?: number;
  children: React.ReactNode;
}) {
  return (
    <motion.section
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay, duration: 0.6 }}
      className="mb-6 p-5 rounded-lg"
      style={{ border: "1px solid oklch(0.94 0.018 301 / 0.08)" }}
    >
      <p className="text-[10px] uppercase tracking-[0.15em] mb-4" style={{ color: "oklch(0.44 0.024 283)" }}>
        {title}
      </p>
      {children}
    </motion.section>
  );
}

function StatusBadge({ status }: { status: ReadingStatus }) {
  const colors: Record<ReadingStatus, { bg: string; text: string }> = {
    pending_payment:  { bg: "oklch(0.65 0.12 60 / 0.15)",  text: "oklch(0.75 0.12 60)" },
    awaiting_response:{ bg: "oklch(0.52 0.118 283 / 0.2)", text: "oklch(0.72 0.078 283)" },
    responded:        { bg: "oklch(0.62 0.104 163 / 0.18)", text: "oklch(0.62 0.104 163)" },
    revealed:         { bg: "oklch(0.62 0.104 163 / 0.18)", text: "oklch(0.62 0.104 163)" },
    expired:          { bg: "oklch(0.44 0.024 283 / 0.2)",  text: "oklch(0.44 0.024 283)" },
  };
  const c = colors[status];
  return (
    <span
      className="text-[9px] uppercase tracking-[0.12em] px-2 py-0.5 rounded-full"
      style={{ background: c.bg, color: c.text }}
    >
      {status.replace("_", " ")}
    </span>
  );
}

function ActionButton({
  onClick,
  disabled,
  color,
  children,
}: {
  onClick: () => void;
  disabled: boolean;
  color: "green" | "red";
  children: React.ReactNode;
}) {
  const styles = {
    green: {
      bg: disabled ? "oklch(0.62 0.104 163 / 0.12)" : "oklch(0.62 0.104 163 / 0.22)",
      text: disabled ? "oklch(0.62 0.104 163 / 0.4)" : "oklch(0.62 0.104 163)",
      border: "oklch(0.62 0.104 163 / 0.25)",
    },
    red: {
      bg: disabled ? "oklch(0.55 0.14 20 / 0.08)" : "oklch(0.55 0.14 20 / 0.15)",
      text: disabled ? "oklch(0.55 0.14 20 / 0.35)" : "oklch(0.65 0.14 20)",
      border: "oklch(0.55 0.14 20 / 0.2)",
    },
  };
  const s = styles[color];
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex-1 py-2.5 rounded-md text-xs uppercase tracking-[0.14em] transition-colors duration-200"
      style={{
        background: s.bg,
        color: s.text,
        border: `1px solid ${s.border}`,
        cursor: disabled ? "not-allowed" : "pointer",
      }}
    >
      {children}
    </button>
  );
}
