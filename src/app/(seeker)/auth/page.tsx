"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { useFlowStore } from "@/lib/flow/store";
import { storeReading, getStoredReadings } from "@/lib/session";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";

const AMOUNT = process.env.NEXT_PUBLIC_PAYMENT_AMOUNT ?? "₱150";
const METHOD = process.env.NEXT_PUBLIC_PAYMENT_METHOD ?? "GCash";
const QR_URL = process.env.NEXT_PUBLIC_PAYMENT_QR_URL ?? "";

export default function PaywallPage() {
  const router = useRouter();
  const blob = useFlowStore((s) => s.blob);
  const mimeType = useFlowStore((s) => s.mimeType);
  const durationMs = useFlowStore((s) => s.durationMs);
  const spreadType = useFlowStore((s) => s.spreadType);
  const positions = useFlowStore((s) => s.positions);
  const clear = useFlowStore((s) => s.clear);

  const [email, setEmail] = useState("");
  const [screenshot, setScreenshot] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!blob) router.replace("/ask");
  }, [blob, router]);

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setScreenshot(f);
    setPreviewUrl(URL.createObjectURL(f));
    setError(null);
  }

  async function handleSubmit() {
    if (!blob || !screenshot) {
      setError("A payment screenshot is needed to continue.");
      return;
    }
    if (!SUPABASE_URL) {
      // Dev fallback: store a placeholder reading and navigate
      const readingId = crypto.randomUUID();
      const sessionToken = crypto.randomUUID();
      storeReading(readingId, sessionToken, spreadType ?? "three");
      clear();
      router.push(`/wait/${readingId}`);
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const edgeFn = (name: string) =>
        `${SUPABASE_URL}/functions/v1/${name}`;

      const fnHeaders = {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? ""}`,
      };

      // Step 1: get signed upload URLs
      const audioExt = mimeType.includes("mp4") ? "mp4" : "webm";
      const screenshotExt = screenshot.type.includes("png") ? "png" : "jpg";

      const urlsRes = await fetch(edgeFn("get_upload_urls"), {
        method: "POST",
        headers: fnHeaders,
        body: JSON.stringify({
          question_audio_ext: audioExt,
          payment_screenshot_ext: screenshotExt,
        }),
      });

      if (!urlsRes.ok) throw new Error("Failed to get upload URLs");
      const { question_audio, payment_screenshot } = await urlsRes.json() as {
        question_audio: { upload_url: string; path: string };
        payment_screenshot: { upload_url: string; path: string };
      };

      // Step 2: upload files in parallel via signed URLs
      const [audioUpload, screenshotUpload] = await Promise.all([
        fetch(question_audio.upload_url, {
          method: "PUT",
          headers: { "Content-Type": mimeType },
          body: blob,
        }),
        fetch(payment_screenshot.upload_url, {
          method: "PUT",
          headers: { "Content-Type": screenshot.type },
          body: screenshot,
        }),
      ]);

      if (!audioUpload.ok || !screenshotUpload.ok) {
        throw new Error("Upload failed");
      }

      // Step 3: submit reading
      const isFirstReading = getStoredReadings().length === 0;
      const submitRes = await fetch(edgeFn("submit_reading"), {
        method: "POST",
        headers: fnHeaders,
        body: JSON.stringify({
          spread_type: spreadType ?? "three",
          positions,
          question_audio_path: question_audio.path,
          question_duration_ms: durationMs || null,
          payment_screenshot_path: payment_screenshot.path,
          email: email || undefined,
          is_first_reading: isFirstReading,
        }),
      });

      if (!submitRes.ok) {
        const err = await submitRes.json().catch(() => ({})) as { error?: string };
        throw new Error(err.error ?? "Submission failed");
      }

      const { reading_id, session_token, species } = await submitRes.json() as {
        reading_id: string;
        session_token: string;
        species?: string;
      };

      storeReading(reading_id, session_token, spreadType ?? "three", species as import("@/types/garden").FlowerSpecies | undefined);
      clear();
      router.push(`/wait/${reading_id}`);
    } catch (err) {
      console.error("submit error:", err);
      setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
      setSubmitting(false);
    }
  }

  if (!blob) return null;

  const canSubmit = !!screenshot && !submitting;

  return (
    <main className="flex flex-col items-center min-h-dvh px-6 pt-10 pb-20">
      <div className="w-full max-w-sm flex flex-col items-center">
        {/* Wordmark */}
        <motion.div
          className="w-full mb-10"
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, ease: "easeOut" }}
        >
          <span
            className="font-display italic text-moonlight/70 tracking-tight leading-none"
            style={{ fontSize: 20 }}
          >
            iris luna
          </span>
        </motion.div>

        {/* Ritual framing */}
        <motion.div
          className="text-center mb-8 w-full"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.15, duration: 0.9, ease: "easeOut" }}
        >
          <p className="text-muted text-[10px] uppercase tracking-[0.2em] mb-3">
            an offering
          </p>
          <p className="font-display italic text-moonlight/80 text-xl leading-snug">
            The ritual asks for {AMOUNT}.
          </p>
          <p className="text-muted text-sm mt-2 leading-relaxed">
            A human will hear your question. This is how you reach them.
          </p>
        </motion.div>

        {/* QR Code */}
        <motion.div
          className="mb-3"
          initial={{ opacity: 0, scale: 0.97 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.3, duration: 0.8, ease: "easeOut" }}
        >
          <div
            className="flex items-center justify-center rounded-lg overflow-hidden"
            style={{
              width: 192,
              height: 192,
              border: "1px dashed oklch(0.94 0.018 301 / 0.18)",
              background: "oklch(0.07 0.018 281 / 0.6)",
            }}
          >
            {QR_URL ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={QR_URL}
                alt="Payment QR code"
                className="w-full h-full object-contain"
              />
            ) : (
              <div className="flex flex-col items-center gap-2 text-center px-4">
                <QRPlaceholderIcon />
                <span className="text-muted text-[10px] uppercase tracking-[0.14em]">
                  QR code pending
                </span>
              </div>
            )}
          </div>
        </motion.div>

        <motion.p
          className="text-muted text-[11px] mb-8 text-center"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.45, duration: 0.7 }}
        >
          {AMOUNT} · {METHOD} · scan, send, then screenshot
        </motion.p>

        <Divider delay={0.5} />

        {/* Email (optional) */}
        <motion.div
          className="w-full mb-6"
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.55, duration: 0.7 }}
        >
          <label
            htmlFor="paywall-email"
            className="block text-muted text-[10px] uppercase tracking-[0.15em] mb-2"
          >
            notify me when the human answers
          </label>
          <input
            id="paywall-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="your@email.com (optional)"
            className="w-full bg-transparent text-moonlight/80 text-sm px-3 py-2.5 rounded-md outline-none transition-colors placeholder:text-muted/40"
            style={{ border: "1px solid oklch(0.94 0.018 301 / 0.12)" }}
            onFocus={(e) =>
              (e.currentTarget.style.borderColor = "oklch(0.72 0.078 283 / 0.35)")
            }
            onBlur={(e) =>
              (e.currentTarget.style.borderColor = "oklch(0.94 0.018 301 / 0.12)")
            }
            autoComplete="email"
            inputMode="email"
          />
        </motion.div>

        <Divider delay={0.6} />

        {/* Screenshot upload */}
        <motion.div
          className="w-full mb-8"
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.65, duration: 0.7 }}
        >
          <p className="text-muted text-[10px] uppercase tracking-[0.15em] mb-3">
            proof of payment
          </p>

          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            onChange={handleFile}
            className="sr-only"
            aria-label="Upload payment screenshot"
          />

          {previewUrl ? (
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="w-full overflow-hidden rounded-lg relative group"
              style={{ border: "1px solid oklch(0.52 0.118 283 / 0.4)" }}
              aria-label="Change screenshot"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={previewUrl}
                alt="Payment screenshot preview"
                className="w-full h-48 object-cover"
              />
              <div
                className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity duration-200"
                style={{ background: "oklch(0.05 0.017 281 / 0.65)" }}
              >
                <span className="text-moonlight/70 text-xs uppercase tracking-[0.15em]">
                  change
                </span>
              </div>
            </button>
          ) : (
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="w-full flex flex-col items-center justify-center gap-3 rounded-lg py-8 transition-colors duration-200"
              style={{
                border: "1px dashed oklch(0.94 0.018 301 / 0.13)",
                background: "oklch(0.07 0.018 281 / 0.4)",
              }}
              aria-label="Upload payment screenshot"
            >
              <UploadIcon />
              <span className="text-muted text-xs uppercase tracking-[0.15em]">
                upload screenshot
              </span>
            </button>
          )}
        </motion.div>

        {/* Error */}
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

        {/* Submit */}
        <motion.button
          type="button"
          onClick={handleSubmit}
          disabled={!canSubmit}
          className="w-full py-3.5 rounded-lg text-sm uppercase tracking-[0.18em] transition-all duration-300"
          style={{
            background: canSubmit
              ? "oklch(0.52 0.118 283)"
              : "oklch(0.52 0.118 283 / 0.22)",
            color: canSubmit
              ? "oklch(0.94 0.018 301)"
              : "oklch(0.94 0.018 301 / 0.3)",
            cursor: canSubmit ? "pointer" : "not-allowed",
          }}
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.75, duration: 0.7 }}
          whileTap={canSubmit ? { scale: 0.98 } : {}}
        >
          {submitting ? "sending…" : "send this reading"}
        </motion.button>

        <motion.p
          className="text-muted/50 text-[10px] text-center mt-4 leading-relaxed"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.85, duration: 0.7 }}
        >
          your reading is held for 24 hours while we verify your payment
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
        background:
          "linear-gradient(to right, transparent, oklch(0.94 0.018 301 / 0.07), transparent)",
      }}
    />
  );
}

function QRPlaceholderIcon() {
  return (
    <svg width="36" height="36" viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect x="3" y="3" width="7" height="7" rx="1" stroke="currentColor" strokeWidth="1.25" className="text-muted" />
      <rect x="14" y="3" width="7" height="7" rx="1" stroke="currentColor" strokeWidth="1.25" className="text-muted" />
      <rect x="3" y="14" width="7" height="7" rx="1" stroke="currentColor" strokeWidth="1.25" className="text-muted" />
      <rect x="5" y="5" width="3" height="3" fill="currentColor" className="text-muted" />
      <rect x="16" y="5" width="3" height="3" fill="currentColor" className="text-muted" />
      <rect x="5" y="16" width="3" height="3" fill="currentColor" className="text-muted" />
      <rect x="14" y="14" width="3" height="3" fill="currentColor" className="text-muted" />
      <rect x="19" y="16" width="2" height="2" fill="currentColor" className="text-muted" />
      <rect x="16" y="19" width="2" height="2" fill="currentColor" className="text-muted" />
    </svg>
  );
}

function UploadIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M12 16V8M12 8L9 11M12 8L15 11"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="text-muted"
      />
      <path
        d="M3 16v1a3 3 0 003 3h12a3 3 0 003-3v-1"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        className="text-muted"
      />
    </svg>
  );
}
