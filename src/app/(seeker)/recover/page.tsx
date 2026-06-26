"use client";

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { storeReading } from "@/lib/session";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

// Auto-inserts the dash after position 3
function formatCode(raw: string): string {
  const clean = raw.toUpperCase().replace(/[^A-Z2-9]/g, "").slice(0, 6);
  if (clean.length > 3) return `${clean.slice(0, 3)}-${clean.slice(3)}`;
  return clean;
}

export default function RecoverPage() {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    setError(null);
    setCode(formatCode(e.target.value));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (code.length !== 7) return; // XXX-XXX

    setLoading(true);
    setError(null);

    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/recover_reading`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${ANON_KEY}`,
        },
        body: JSON.stringify({ recovery_code: code }),
      });

      const data = await res.json() as {
        reading_id?: string;
        session_token?: string;
        spread_type?: "single" | "three";
        status?: string;
        error?: string;
      };

      if (!res.ok || !data.reading_id || !data.session_token) {
        setError(data.error ?? "No reading found for that code.");
        setLoading(false);
        return;
      }

      storeReading(
        data.reading_id,
        data.session_token,
        data.spread_type ?? "three",
        undefined,
        code,
      );

      router.replace(`/wait/${data.reading_id}`);
    } catch {
      setError("Something went wrong. Check your connection and try again.");
      setLoading(false);
    }
  }

  const ready = code.length === 7 && !loading;

  return (
    <main className="flex flex-col items-center justify-center min-h-dvh px-8">
      <motion.div
        className="w-full max-w-xs flex flex-col items-center gap-8"
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.9, ease: "easeOut" }}
      >
        <div className="flex flex-col items-center gap-1 text-center">
          <span
            className="font-display italic text-moonlight/70 tracking-tight"
            style={{ fontSize: 22 }}
          >
            iris luna
          </span>
          <p className="text-muted text-[10px] uppercase tracking-[0.2em]">
            restore a reading
          </p>
        </div>

        <p className="text-sm text-center leading-relaxed" style={{ color: "rgba(183,174,234,0.45)" }}>
          Enter the recovery code from your wait screen to restore your reading on this device.
        </p>

        <form onSubmit={handleSubmit} className="w-full flex flex-col items-center gap-5">
          <input
            ref={inputRef}
            type="text"
            inputMode="text"
            autoCapitalize="characters"
            autoComplete="off"
            spellCheck={false}
            value={code}
            onChange={handleChange}
            placeholder="ABC-DEF"
            maxLength={7}
            className="w-full text-center bg-transparent text-moonlight/80 text-xl font-mono tracking-[0.3em] px-4 py-3 rounded-lg outline-none transition-colors placeholder:text-muted/25"
            style={{ border: "1px solid rgba(183,174,234,0.14)" }}
            onFocus={(e) => (e.currentTarget.style.borderColor = "rgba(124,111,203,0.45)")}
            onBlur={(e) => (e.currentTarget.style.borderColor = "rgba(183,174,234,0.14)")}
            aria-label="Recovery code"
          />

          <AnimatePresence>
            {error && (
              <motion.p
                className="text-sm text-center"
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

          <button
            type="submit"
            disabled={!ready}
            className="w-full py-3 rounded-lg text-sm uppercase tracking-[0.18em] transition-all duration-300"
            style={{
              background: ready ? "oklch(0.52 0.118 283)" : "oklch(0.52 0.118 283 / 0.2)",
              color: ready ? "oklch(0.94 0.018 301)" : "oklch(0.94 0.018 301 / 0.3)",
              cursor: ready ? "pointer" : "not-allowed",
            }}
          >
            {loading ? "looking up…" : "restore reading"}
          </button>
        </form>

        <button
          type="button"
          onClick={() => router.push("/")}
          className="text-muted/40 text-[10px] uppercase tracking-[0.18em] hover:text-muted/70 transition-colors"
        >
          ← back
        </button>
      </motion.div>
    </main>
  );
}
