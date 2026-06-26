"use client";

import Link from "next/link";
import { motion, useReducedMotion } from "framer-motion";

export function AskButton() {
  const reduced = useReducedMotion();

  return (
    <Link href="/ask" className="group outline-none" aria-label="Ask a question">
      <motion.div
        className="relative flex items-center justify-center"
        animate={reduced ? {} : { scale: [1, 1.04, 1] }}
        transition={{ duration: 3.2, repeat: Infinity, ease: "easeInOut" }}
      >
        {/* Outer moon halo ring */}
        <motion.div
          className="absolute rounded-full"
          style={{
            width: 118,
            height: 118,
            border: "1px solid rgba(183,174,234,0.12)",
          }}
          animate={reduced ? {} : { opacity: [0.5, 0.9, 0.5] }}
          transition={{ duration: 3.2, repeat: Infinity, ease: "easeInOut" }}
        />

        {/* Middle ring — iris glow */}
        <motion.div
          className="absolute rounded-full"
          style={{
            width: 96,
            height: 96,
            border: "1px solid rgba(124,111,203,0.22)",
          }}
          animate={reduced ? {} : { opacity: [0.4, 0.75, 0.4] }}
          transition={{ duration: 3.2, repeat: Infinity, ease: "easeInOut", delay: 0.15 }}
        />

        {/* Main button face */}
        <div
          className="relative z-10 flex items-center justify-center rounded-full cursor-pointer transition-colors duration-500 ease-out"
          style={{
            width: 80,
            height: 80,
            background: "rgba(124,111,203,0.07)",
            border: "1px solid rgba(183,174,234,0.28)",
          }}
        >
          {/* Inner iris fill on hover — handled via pseudo not available in Tailwind, use inline */}
          <motion.div
            className="absolute inset-0 rounded-full"
            style={{ background: "rgba(124,111,203,0.1)" }}
            initial={{ opacity: 0 }}
            whileHover={{ opacity: 1 }}
            transition={{ duration: 0.4 }}
          />

          <span
            className="relative font-display italic text-moonlight/75 group-hover:text-moonlight transition-colors duration-400"
            style={{ fontSize: 22, letterSpacing: "-0.01em" }}
          >
            Ask
          </span>
        </div>
      </motion.div>
    </Link>
  );
}
