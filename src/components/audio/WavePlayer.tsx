"use client";

import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";

interface WavePlayerProps {
  src: string;
  label?: string;
}

export function WavePlayer({ src, label }: WavePlayerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<import("wavesurfer.js").default | null>(null);
  const [playing, setPlaying] = useState(false);
  const [ready, setReady] = useState(false);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    if (!containerRef.current) return;
    let ws: import("wavesurfer.js").default;

    import("wavesurfer.js").then(({ default: WaveSurfer }) => {
      ws = WaveSurfer.create({
        container: containerRef.current!,
        waveColor: "rgba(183,174,234,0.25)",
        progressColor: "rgba(183,174,234,0.7)",
        cursorColor: "transparent",
        barWidth: 2,
        barGap: 2,
        barRadius: 2,
        height: 36,
        normalize: true,
        interact: true,
      });

      ws.load(src);
      ws.on("ready", () => setReady(true));
      ws.on("play", () => setPlaying(true));
      ws.on("pause", () => setPlaying(false));
      ws.on("finish", () => { setPlaying(false); setProgress(0); });
      ws.on("timeupdate", (t) => {
        const dur = ws.getDuration();
        if (dur > 0) setProgress(t / dur);
      });
      wsRef.current = ws;
    });

    return () => { ws?.destroy(); };
  }, [src]);

  function toggle() {
    wsRef.current?.playPause();
  }

  return (
    <div className="flex flex-col gap-2">
      {label && (
        <p className="text-muted text-[10px] uppercase tracking-[0.16em]">{label}</p>
      )}
      <div className="flex items-center gap-3">
        {/* Play/pause button */}
        <motion.button
          onClick={toggle}
          disabled={!ready}
          whileTap={ready ? { scale: 0.92 } : {}}
          className="flex-shrink-0 flex items-center justify-center rounded-full transition-opacity"
          style={{
            width: 36,
            height: 36,
            border: "1px solid rgba(183,174,234,0.25)",
            background: "rgba(124,111,203,0.08)",
            opacity: ready ? 1 : 0.4,
          }}
          aria-label={playing ? "Pause" : "Play"}
        >
          {playing ? (
            <svg width={14} height={14} viewBox="0 0 14 14" fill="none" aria-hidden>
              <rect x={2} y={2} width={4} height={10} rx={1} fill="#B7AEEA" />
              <rect x={8} y={2} width={4} height={10} rx={1} fill="#B7AEEA" />
            </svg>
          ) : (
            <svg width={14} height={14} viewBox="0 0 14 14" fill="none" aria-hidden>
              <path d="M3 2L12 7L3 12V2Z" fill="#B7AEEA" />
            </svg>
          )}
        </motion.button>

        {/* Waveform */}
        <div ref={containerRef} className="flex-1 min-w-0" />
      </div>

      {/* Progress line (fallback if waveform is loading) */}
      {!ready && (
        <div
          className="h-0.5 rounded-full overflow-hidden"
          style={{ background: "rgba(183,174,234,0.1)" }}
        >
          <motion.div
            className="h-full rounded-full"
            style={{ background: "rgba(183,174,234,0.3)", width: `${progress * 100}%` }}
          />
        </div>
      )}
    </div>
  );
}
