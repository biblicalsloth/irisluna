"use client";

import { useRef, useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { AudioRecorder } from "@/lib/audio/recorder";

const DEFAULT_MAX_MS = 60_000;
const MIN_MS = 1_000;
const R = 52;
const CX = 70;
const CY = 70;
const CIRCUMFERENCE = 2 * Math.PI * R;
const CANCEL_THRESHOLD = 48;

type Phase = "idle" | "recording" | "tooShort" | "permissionDenied";

interface HoldToRecordProps {
  onComplete: (blob: Blob, mimeType: string, durationMs: number) => void;
  maxMs?: number;
}

export function HoldToRecord({ onComplete, maxMs = DEFAULT_MAX_MS }: HoldToRecordProps) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [progress, setProgress] = useState(0);
  const recorderRef = useRef<AudioRecorder | null>(null);
  const rafRef = useRef<number>(0);
  const startRef = useRef<number>(0);
  const holdingRef = useRef(false);
  const pointerOrigin = useRef({ x: 0, y: 0 });

  const tick = useCallback(() => {
    if (!holdingRef.current) return;
    const elapsed = Date.now() - startRef.current;
    const p = Math.min(elapsed / maxMs, 1);
    setProgress(p);
    if (p >= 1) {
      stopRecording();
    } else {
      rafRef.current = requestAnimationFrame(tick);
    }
  }, [maxMs]); // eslint-disable-line react-hooks/exhaustive-deps

  const startRecording = useCallback(async (e: React.PointerEvent) => {
    if (phase === "recording") return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    pointerOrigin.current = { x: e.clientX, y: e.clientY };
    holdingRef.current = true;

    try {
      const recorder = new AudioRecorder();
      await recorder.start();
      recorderRef.current = recorder;
      startRef.current = Date.now();
      setPhase("recording");
      setProgress(0);
      navigator.vibrate?.(12);
      rafRef.current = requestAnimationFrame(tick);
    } catch {
      holdingRef.current = false;
      setPhase("permissionDenied");
    }
  }, [phase, tick]);

  const stopRecording = useCallback(async (cancelled = false) => {
    if (!holdingRef.current && phase !== "recording") return;
    holdingRef.current = false;
    cancelAnimationFrame(rafRef.current);

    const recorder = recorderRef.current;
    recorderRef.current = null;
    if (!recorder) return;

    if (cancelled) {
      recorder.cancel();
      setPhase("idle");
      setProgress(0);
      return;
    }

    const elapsed = Date.now() - startRef.current;
    if (elapsed < MIN_MS) {
      recorder.cancel();
      setPhase("tooShort");
      setProgress(0);
      setTimeout(() => setPhase("idle"), 1600);
      return;
    }

    const result = await recorder.stop();
    setPhase("idle");
    setProgress(0);
    onComplete(result.blob, result.mimeType, result.durationMs);
  }, [phase, onComplete]);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!holdingRef.current) return;
    const dx = e.clientX - pointerOrigin.current.x;
    const dy = e.clientY - pointerOrigin.current.y;
    if (Math.sqrt(dx * dx + dy * dy) > CANCEL_THRESHOLD) {
      stopRecording(true);
    }
  }, [stopRecording]);

  const dashOffset = CIRCUMFERENCE * (1 - progress);
  const isRecording = phase === "recording";

  return (
    <div className="flex flex-col items-center gap-7 select-none">
      <div
        className="relative touch-none cursor-pointer"
        onPointerDown={startRecording}
        onPointerUp={() => stopRecording(false)}
        onPointerMove={onPointerMove}
        onPointerCancel={() => stopRecording(true)}
        role="button"
        aria-label="Hold to record your question"
        aria-pressed={isRecording}
      >
        <motion.svg
          width={140}
          height={140}
          viewBox="0 0 140 140"
          animate={
            isRecording
              ? { scale: 1.04 }
              : { scale: [0.97, 1.03, 0.97] }
          }
          transition={
            isRecording
              ? { duration: 0.2, ease: "easeOut" }
              : { duration: 4.2, repeat: Infinity, ease: "easeInOut" }
          }
        >
          {/* Moon halo — outer ring, barely there */}
          <circle
            cx={CX} cy={CY} r={68}
            fill="none"
            stroke="#B7AEEA"
            strokeWidth={1}
            opacity={isRecording ? 0.04 : 0.08}
          />
          {/* Track ring */}
          <circle
            cx={CX} cy={CY} r={R}
            fill="none"
            stroke="#7C6FCB"
            strokeWidth={1.5}
            opacity={0.18}
          />
          {/* Fill arc */}
          <motion.circle
            cx={CX} cy={CY} r={R}
            fill="none"
            stroke="#B7AEEA"
            strokeWidth={2}
            strokeLinecap="round"
            strokeDasharray={CIRCUMFERENCE}
            strokeDashoffset={dashOffset}
            transform={`rotate(-90 ${CX} ${CY})`}
            animate={{ strokeDashoffset: dashOffset, opacity: isRecording ? 0.9 : 0 }}
            transition={{ duration: 0.04 }}
          />
          {/* Inner iris glow when recording */}
          <motion.circle
            cx={CX} cy={CY} r={18}
            fill="#7C6FCB"
            animate={{ opacity: isRecording ? 0.12 : 0, r: isRecording ? 22 : 18 }}
            transition={{ duration: 0.4 }}
          />
          {/* Center dot */}
          <motion.circle
            cx={CX} cy={CY} r={isRecording ? 7 : 4}
            fill={isRecording ? "#B7AEEA" : "#7C6FCB"}
            animate={{ opacity: isRecording ? 0.9 : 0.35 }}
            transition={{ duration: 0.3 }}
          />
        </motion.svg>
      </div>

      {/* Status label */}
      <AnimatePresence mode="wait">
        {phase === "idle" && (
          <motion.p
            key="idle"
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.35 }}
            className="text-muted text-[11px] uppercase tracking-[0.16em]"
          >
            hold to speak your question
          </motion.p>
        )}
        {phase === "recording" && (
          <motion.p
            key="recording"
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.35 }}
            className="text-[11px] uppercase tracking-[0.16em]"
            style={{ color: "#B7AEEA" }}
          >
            speaking…
          </motion.p>
        )}
        {phase === "tooShort" && (
          <motion.p
            key="short"
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.35 }}
            className="text-muted text-[11px] uppercase tracking-[0.16em]"
          >
            keep holding
          </motion.p>
        )}
        {phase === "permissionDenied" && (
          <motion.p
            key="denied"
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.35 }}
            className="text-muted text-[11px] tracking-[0.06em] text-center max-w-[200px] leading-relaxed"
          >
            microphone access is needed.{" "}
            <button
              onClick={() => setPhase("idle")}
              className="underline underline-offset-2 text-iris-300 cursor-pointer"
            >
              try again
            </button>
          </motion.p>
        )}
      </AnimatePresence>

      {/* Slide-to-cancel hint — only while recording, very faint */}
      <AnimatePresence>
        {isRecording && (
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 0.3 }}
            exit={{ opacity: 0 }}
            transition={{ delay: 0.8, duration: 0.5 }}
            className="text-muted text-[10px] tracking-[0.08em]"
          >
            slide away to cancel
          </motion.p>
        )}
      </AnimatePresence>
    </div>
  );
}
