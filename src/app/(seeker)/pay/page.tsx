"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { useFlowStore } from "@/lib/flow/store";
import { getSeeker, setSeeker } from "@/lib/session";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
const AMOUNT = process.env.NEXT_PUBLIC_PAYMENT_AMOUNT ?? "₱150";

function formatCode(raw: string): string {
  const clean = raw.toUpperCase().replace(/[^A-Z2-9]/g, "").slice(0, 12);
  if (clean.length > 8) return `${clean.slice(0, 4)}-${clean.slice(4, 8)}-${clean.slice(8)}`;
  if (clean.length > 4) return `${clean.slice(0, 4)}-${clean.slice(4)}`;
  return clean;
}

export default function PayPage() {
  const router = useRouter();
  const blob = useFlowStore((s) => s.blob);
  const mimeType = useFlowStore((s) => s.mimeType);
  const durationMs = useFlowStore((s) => s.durationMs);
  const spreadType = useFlowStore((s) => s.spreadType);
  const positions = useFlowStore((s) => s.positions);

  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Garden-key entry (returning users)
  const [showKeyEntry, setShowKeyEntry] = useState(false);
  const [code, setCode] = useState("");
  const [keyBusy, setKeyBusy] = useState(false);
  const [keyOk, setKeyOk] = useState(false);
  const [keyError, setKeyError] = useState<string | null>(null);

  useEffect(() => {
    if (!blob) router.replace("/ask");
  }, [blob, router]);

  async function attachKey() {
    if (code.length !== 14) return;
    setKeyBusy(true);
    setKeyError(null);
    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/restore_garden`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${ANON_KEY}` },
        body: JSON.stringify({ garden_code: code }),
      });
      const data = await res.json() as { seeker_id?: string; error?: string };
      if (!res.ok || !data.seeker_id) {
        setKeyError(data.error ?? "No garden found for that code.");
        return;
      }
      setSeeker(data.seeker_id, code);
      setKeyOk(true);
    } catch {
      setKeyError("Something went wrong. Try again.");
    } finally {
      setKeyBusy(false);
    }
  }

  async function handlePay() {
    if (!blob) return;
    setSubmitting(true);
    setError(null);
    try {
      const edgeFn = (name: string) => `${SUPABASE_URL}/functions/v1/${name}`;
      const fnHeaders = {
        "Content-Type": "application/json",
        Authorization: `Bearer ${ANON_KEY}`,
      };

      // 1. signed upload URL (audio only)
      const audioExt = mimeType.includes("mp4") ? "mp4" : "webm";
      const urlsRes = await fetch(edgeFn("get_upload_urls"), {
        method: "POST",
        headers: fnHeaders,
        body: JSON.stringify({ question_audio_ext: audioExt }),
      });
      if (!urlsRes.ok) throw new Error("Failed to get upload URL");
      const { question_audio } = await urlsRes.json() as {
        question_audio: { upload_url: string; path: string };
      };

      // 2. upload audio
      const audioUpload = await fetch(question_audio.upload_url, {
        method: "PUT",
        headers: { "Content-Type": mimeType },
        body: blob,
      });
      if (!audioUpload.ok) throw new Error("Upload failed");

      // 3. create the pending reading (attach seeker if a key was entered)
      const submitRes = await fetch(edgeFn("submit_reading"), {
        method: "POST",
        headers: fnHeaders,
        body: JSON.stringify({
          spread_type: spreadType ?? "three",
          positions,
          question_audio_path: question_audio.path,
          question_duration_ms: durationMs || null,
          email: email || undefined,
          seeker_id: getSeeker()?.seekerId,
        }),
      });
      if (!submitRes.ok) {
        const err = await submitRes.json().catch(() => ({})) as { error?: string };
        throw new Error(err.error ?? "Submission failed");
      }
      const { reading_id, session_token } = await submitRes.json() as {
        reading_id: string;
        session_token: string;
      };

      // 4. create Dodo checkout and redirect
      const checkoutRes = await fetch(edgeFn("create_checkout"), {
        method: "POST",
        headers: fnHeaders,
        body: JSON.stringify({ reading_id, session_token }),
      });
      if (!checkoutRes.ok) {
        const err = await checkoutRes.json().catch(() => ({})) as { error?: string };
        throw new Error(err.error ?? "Could not start checkout");
      }
      const { checkout_url } = await checkoutRes.json() as { checkout_url: string };
      window.location.href = checkout_url;
    } catch (err) {
      console.error("pay error:", err);
      setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
      setSubmitting(false);
    }
  }

  if (!blob) return null;

  return (
    <main className="flex flex-col items-center min-h-dvh px-6 pt-10 pb-20">
      <div className="w-full max-w-sm flex flex-col items-center">
        <motion.div
          className="w-full mb-10"
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, ease: "easeOut" }}
        >
          <span className="font-display italic text-moonlight/70 tracking-tight leading-none" style={{ fontSize: 20 }}>
            iris luna
          </span>
        </motion.div>

        <motion.div
          className="text-center mb-8 w-full"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.15, duration: 0.9, ease: "easeOut" }}
        >
          <p className="text-muted text-[10px] uppercase tracking-[0.2em] mb-3">an offering</p>
          <p className="font-display italic text-moonlight/80 text-xl leading-snug">
            The ritual asks for {AMOUNT}.
          </p>
          <p className="text-muted text-sm mt-2 leading-relaxed">
            A human will hear your question. This is how you reach them.
          </p>
        </motion.div>

        <Divider delay={0.3} />

        {/* Optional email — notify when answered */}
        <motion.div
          className="w-full mb-6"
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4, duration: 0.7 }}
        >
          <label htmlFor="pay-email" className="block text-muted text-[10px] uppercase tracking-[0.15em] mb-2">
            notify me when the human answers
          </label>
          <input
            id="pay-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="your@email.com (optional)"
            className="w-full bg-transparent text-moonlight/80 text-sm px-3 py-2.5 rounded-md outline-none transition-colors placeholder:text-muted/40"
            style={{ border: "1px solid oklch(0.94 0.018 301 / 0.12)" }}
            autoComplete="email"
            inputMode="email"
          />
        </motion.div>

        {/* Returning user: attach existing garden */}
        <motion.div
          className="w-full mb-6"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.5, duration: 0.7 }}
        >
          {keyOk ? (
            <p className="text-[11px] uppercase tracking-[0.15em] text-center" style={{ color: "oklch(0.72 0.078 283)" }}>
              this reading will join your garden
            </p>
          ) : !showKeyEntry ? (
            <button
              type="button"
              onClick={() => setShowKeyEntry(true)}
              className="w-full text-muted/60 text-[11px] uppercase tracking-[0.15em] hover:text-muted transition-colors"
            >
              I already have a garden key
            </button>
          ) : (
            <div className="flex flex-col gap-3">
              <input
                type="text"
                inputMode="text"
                autoCapitalize="characters"
                spellCheck={false}
                value={code}
                onChange={(e) => { setKeyError(null); setCode(formatCode(e.target.value)); }}
                placeholder="ABCD-EFGH-JKLM"
                maxLength={14}
                className="w-full text-center bg-transparent text-moonlight/80 text-base font-mono tracking-[0.25em] px-3 py-2.5 rounded-md outline-none placeholder:text-muted/30"
                style={{ border: "1px solid oklch(0.94 0.018 301 / 0.14)" }}
                aria-label="Garden key"
              />
              {keyError && (
                <p className="text-xs text-center" style={{ color: "oklch(0.65 0.14 20)" }}>{keyError}</p>
              )}
              <button
                type="button"
                onClick={() => void attachKey()}
                disabled={code.length !== 14 || keyBusy}
                className="text-[11px] uppercase tracking-[0.15em] transition-colors"
                style={{ color: code.length === 14 && !keyBusy ? "oklch(0.72 0.078 283)" : "oklch(0.72 0.078 283 / 0.35)" }}
              >
                {keyBusy ? "checking…" : "attach garden"}
              </button>
            </div>
          )}
        </motion.div>

        <AnimatePresence>
          {error && (
            <motion.p
              className="text-sm text-center mb-4 w-full"
              style={{ color: "oklch(0.65 0.14 20)" }}
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.25 }}
            >
              {error}
            </motion.p>
          )}
        </AnimatePresence>

        <motion.button
          type="button"
          onClick={() => void handlePay()}
          disabled={submitting}
          className="w-full py-3.5 rounded-lg text-sm uppercase tracking-[0.18em] transition-all duration-300"
          style={{
            background: submitting ? "oklch(0.52 0.118 283 / 0.22)" : "oklch(0.52 0.118 283)",
            color: submitting ? "oklch(0.94 0.018 301 / 0.3)" : "oklch(0.94 0.018 301)",
            cursor: submitting ? "not-allowed" : "pointer",
          }}
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.6, duration: 0.7 }}
          whileTap={submitting ? {} : { scale: 0.98 }}
        >
          {submitting ? "opening payment…" : `pay ${AMOUNT}`}
        </motion.button>

        <motion.p
          className="text-muted/50 text-[10px] text-center mt-4 leading-relaxed"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.7, duration: 0.7 }}
        >
          If you leave without paying, this reading is released — nothing is saved until payment completes.
        </motion.p>
      </div>
    </main>
  );
}

function Divider({ delay }: { delay: number }) {
  return (
    <motion.div
      className="w-full mb-6"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ delay, duration: 0.7 }}
      aria-hidden
      style={{
        height: 1,
        background: "linear-gradient(to right, transparent, oklch(0.94 0.018 301 / 0.07), transparent)",
      }}
    />
  );
}
