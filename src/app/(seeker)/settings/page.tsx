"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import Link from "next/link";

type MicState = "unknown" | "granted" | "denied" | "prompt" | "unsupported";

export default function SettingsPage() {
  const router = useRouter();
  const [micState, setMicState] = useState<MicState>("unknown");
  const [requesting, setRequesting] = useState(false);

  useEffect(() => {
    if (!navigator.permissions) {
      setMicState("unsupported");
      return;
    }
    navigator.permissions
      .query({ name: "microphone" as PermissionName })
      .then((result) => {
        setMicState(result.state as MicState);
        result.onchange = () => setMicState(result.state as MicState);
      })
      .catch(() => setMicState("unsupported"));
  }, []);

  async function requestMic() {
    setRequesting(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((t) => t.stop());
      setMicState("granted");
    } catch {
      setMicState("denied");
    } finally {
      setRequesting(false);
    }
  }

  const micLabel: Record<MicState, string> = {
    unknown: "checking…",
    granted: "allowed",
    denied: "blocked",
    prompt: "not yet asked",
    unsupported: "not available",
  };

  const micColor: Record<MicState, string> = {
    unknown: "oklch(0.44 0.024 283)",
    granted: "oklch(0.62 0.104 163)",
    denied: "oklch(0.65 0.14 20)",
    prompt: "oklch(0.79 0.099 82)",
    unsupported: "oklch(0.44 0.024 283)",
  };

  return (
    <main className="flex flex-col min-h-dvh px-6 pt-10 pb-20 max-w-sm mx-auto">
      <motion.div
        initial={{ opacity: 0, y: -4 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.7 }}
        className="mb-10"
      >
        <button
          type="button"
          onClick={() => router.back()}
          className="text-muted/50 text-[10px] uppercase tracking-[0.14em] hover:text-muted transition-colors mb-4 block"
        >
          ← back
        </button>
        <span
          className="font-display italic tracking-tight leading-none"
          style={{ fontSize: 22, color: "oklch(0.94 0.018 301 / 0.65)" }}
        >
          settings
        </span>
      </motion.div>

      {/* Microphone permission */}
      <motion.section
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.15, duration: 0.7 }}
        className="mb-6 p-5 rounded-lg"
        style={{ border: "1px solid oklch(0.94 0.018 301 / 0.08)" }}
      >
        <p className="text-[10px] uppercase tracking-[0.15em] mb-4" style={{ color: "oklch(0.44 0.024 283)" }}>
          microphone
        </p>

        <div className="flex items-center justify-between mb-4">
          <p className="text-sm" style={{ color: "oklch(0.94 0.018 301 / 0.7)" }}>
            Permission
          </p>
          <span
            className="text-xs uppercase tracking-[0.12em]"
            style={{ color: micColor[micState] }}
          >
            {micLabel[micState]}
          </span>
        </div>

        {(micState === "prompt" || micState === "unsupported") && (
          <button
            type="button"
            onClick={() => void requestMic()}
            disabled={requesting || micState === "unsupported"}
            className="w-full py-2.5 rounded-md text-xs uppercase tracking-[0.16em] transition-all duration-200"
            style={{
              background: "oklch(0.52 0.118 283 / 0.22)",
              color: "oklch(0.94 0.018 301 / 0.7)",
              cursor: requesting || micState === "unsupported" ? "not-allowed" : "pointer",
            }}
          >
            {requesting ? "requesting…" : "allow microphone"}
          </button>
        )}

        {micState === "denied" && (
          <p className="text-[11px] leading-relaxed" style={{ color: "oklch(0.44 0.024 283 / 0.8)" }}>
            Microphone access is blocked. Open your browser or device settings to allow it, then reload.
          </p>
        )}

        {micState === "granted" && (
          <p className="text-[11px] leading-relaxed" style={{ color: "oklch(0.44 0.024 283 / 0.7)" }}>
            Iris Luna can record your question. Permission is only used when you hold to record.
          </p>
        )}
      </motion.section>

      {/* Data note */}
      <motion.section
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.25, duration: 0.7 }}
        className="mb-6 p-5 rounded-lg"
        style={{ border: "1px solid oklch(0.94 0.018 301 / 0.08)" }}
      >
        <p className="text-[10px] uppercase tracking-[0.15em] mb-4" style={{ color: "oklch(0.44 0.024 283)" }}>
          your data
        </p>
        <p className="text-[11px] leading-relaxed mb-3" style={{ color: "oklch(0.44 0.024 283 / 0.8)" }}>
          No account is created. Your readings are stored on this device only. Voice notes are held privately and heard by one reader.
        </p>
        <p className="text-[11px] leading-relaxed" style={{ color: "oklch(0.44 0.024 283 / 0.8)" }}>
          Clearing your browser data removes your garden. There is no recovery.
        </p>
      </motion.section>

      {/* Crisis link */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.4, duration: 0.8 }}
        className="flex items-center justify-center"
      >
        <a
          href="https://www.opencounseling.com/hotlines-ph"
          target="_blank"
          rel="noopener noreferrer"
          className="text-[10px] uppercase tracking-[0.16em] transition-colors hover:text-muted"
          style={{ color: "oklch(0.44 0.024 283 / 0.5)" }}
        >
          support resources
        </a>
      </motion.div>
    </main>
  );
}
