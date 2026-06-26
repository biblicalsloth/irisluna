"use client";

import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { HoldToRecord } from "@/components/audio/HoldToRecord";
import { useFlowStore } from "@/lib/flow/store";

export default function AskPage() {
  const router = useRouter();
  const setRecording = useFlowStore((s) => s.setRecording);
  const blob = useFlowStore((s) => s.blob);

  function handleComplete(b: Blob, mimeType: string, durationMs: number) {
    setRecording(b, mimeType, durationMs);
    router.push("/deck");
  }

  return (
    <main className="flex flex-col min-h-dvh">
      {/* Centered ring — takes full vertical space */}
      <div className="flex-1 flex items-center justify-center px-6">
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.9, ease: "easeOut" }}
        >
          <HoldToRecord onComplete={handleComplete} />
        </motion.div>
      </div>

      {/* Minimal bottom chrome */}
      <motion.nav
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.6, duration: 0.6 }}
        className="flex items-center justify-between px-6 pb-8 pt-4"
      >
        <button
          onClick={() => router.push("/")}
          className="text-muted text-[11px] uppercase tracking-[0.14em] hover:text-moonlight/60 transition-colors cursor-pointer"
        >
          ← back
        </button>

        {/* Re-record affordance — visible only if a blob already exists from this session */}
        {blob && (
          <motion.span
            initial={{ opacity: 0 }}
            animate={{ opacity: 0.5 }}
            className="text-muted text-[10px] tracking-[0.08em]"
          >
            recording ready — hold again to redo
          </motion.span>
        )}
      </motion.nav>
    </main>
  );
}
