"use client";

import { Suspense, useState, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { createClient } from "@/lib/supabase/client";

type Phase = "idle" | "sending" | "sent" | "error";

function AdminLoginInner() {
  const searchParams = useSearchParams();
  const callbackError = searchParams.get("error");

  const [email, setEmail] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(
    callbackError ? "That link has expired. Try again." : null,
  );

  // If already authenticated, redirect to admin
  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) window.location.replace("/admin");
    });
  }, []);

  async function handleSend() {
    if (!email.trim()) return;
    setPhase("sending");
    setError(null);

    const supabase = createClient();
    const { error: otpErr } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback?next=/admin`,
      },
    });

    if (otpErr) {
      setError(otpErr.message);
      setPhase("error");
    } else {
      setPhase("sent");
    }
  }

  return (
    <main className="flex flex-col items-center justify-center min-h-dvh px-6">
      <motion.div
        className="w-full max-w-sm flex flex-col items-center"
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.9, ease: "easeOut" }}
      >
        <div className="mb-10 text-center">
          <span
            className="font-display italic tracking-tight"
            style={{ fontSize: 22, color: "oklch(0.94 0.018 301 / 0.65)" }}
          >
            iris luna
          </span>
          <p
            className="text-[10px] uppercase tracking-[0.2em] mt-1"
            style={{ color: "oklch(0.44 0.024 283)" }}
          >
            reader access
          </p>
        </div>

        <AnimatePresence mode="wait">
          {phase !== "sent" ? (
            <motion.div
              key="form"
              className="w-full flex flex-col gap-4"
              initial={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.3 }}
            >
              <div className="flex flex-col gap-1.5">
                <label
                  htmlFor="admin-email"
                  className="text-[10px] uppercase tracking-[0.15em]"
                  style={{ color: "oklch(0.44 0.024 283)" }}
                >
                  email address
                </label>
                <input
                  id="admin-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && void handleSend()}
                  placeholder="you@example.com"
                  className="w-full bg-transparent text-moonlight/80 text-sm px-3 py-2.5 rounded-md outline-none transition-colors placeholder:text-muted/40"
                  style={{ border: "1px solid oklch(0.94 0.018 301 / 0.12)" }}
                  onFocus={(e) => (e.currentTarget.style.borderColor = "oklch(0.72 0.078 283 / 0.35)")}
                  onBlur={(e) => (e.currentTarget.style.borderColor = "oklch(0.94 0.018 301 / 0.12)")}
                  autoComplete="email"
                  autoFocus
                  disabled={phase === "sending"}
                />
              </div>

              <AnimatePresence>
                {error && (
                  <motion.p
                    className="text-xs text-center"
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
                type="button"
                onClick={() => void handleSend()}
                disabled={!email.trim() || phase === "sending"}
                className="w-full py-3 rounded-lg text-sm uppercase tracking-[0.18em] transition-all duration-300"
                style={{
                  background:
                    !email.trim() || phase === "sending"
                      ? "oklch(0.52 0.118 283 / 0.22)"
                      : "oklch(0.52 0.118 283)",
                  color:
                    !email.trim() || phase === "sending"
                      ? "oklch(0.94 0.018 301 / 0.35)"
                      : "oklch(0.94 0.018 301)",
                  cursor: !email.trim() || phase === "sending" ? "not-allowed" : "pointer",
                }}
              >
                {phase === "sending" ? "sending…" : "send magic link"}
              </button>
            </motion.div>
          ) : (
            <motion.div
              key="sent"
              className="text-center flex flex-col gap-3"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6 }}
            >
              <p
                className="font-display italic text-lg"
                style={{ color: "oklch(0.94 0.018 301 / 0.7)" }}
              >
                check your email
              </p>
              <p className="text-muted text-sm leading-relaxed">
                A link is on its way to{" "}
                <span style={{ color: "oklch(0.72 0.078 283)" }}>{email}</span>.
                <br />
                Click it to enter the reader panel.
              </p>
              <button
                type="button"
                onClick={() => { setPhase("idle"); setEmail(""); }}
                className="text-muted/50 text-[10px] uppercase tracking-[0.14em] mt-4 hover:text-muted transition-colors"
              >
                try a different email
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </main>
  );
}

export default function AdminLoginPage() {
  return (
    <Suspense>
      <AdminLoginInner />
    </Suspense>
  );
}
