"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import { createClient } from "@/lib/supabase/client";
import type { ReadingStatus } from "@/lib/supabase/types";

type Tab = "payments" | "queue";

interface QueueRow {
  id: string;
  spread_type: "single" | "three";
  status: ReadingStatus;
  created_at: string;
  email: string | null;
}

export default function AdminQueuePage() {
  const [tab, setTab] = useState<Tab>("payments");
  const [payments, setPayments] = useState<QueueRow[]>([]);
  const [queue, setQueue] = useState<QueueRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const supabase = createClient();

    const [paymentsRes, queueRes] = await Promise.all([
      supabase
        .from("readings")
        .select("id, spread_type, status, created_at, email")
        .eq("status", "pending_payment")
        .order("created_at", { ascending: false }),
      supabase
        .from("readings")
        .select("id, spread_type, status, created_at, email")
        .eq("status", "awaiting_response")
        .order("created_at", { ascending: true }), // oldest first for queue
    ]);

    setPayments((paymentsRes.data ?? []) as QueueRow[]);
    setQueue((queueRes.data ?? []) as QueueRow[]);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
    const interval = setInterval(() => void load(), 30_000);
    return () => clearInterval(interval);
  }, [load]);

  return (
    <main className="flex flex-col min-h-dvh px-6 pt-10 pb-16 max-w-2xl mx-auto">
      <motion.div
        initial={{ opacity: 0, y: -4 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.7 }}
        className="mb-8 flex items-baseline justify-between"
      >
        <span
          className="font-display italic tracking-tight leading-none"
          style={{ fontSize: 20, color: "oklch(0.94 0.018 301 / 0.7)" }}
        >
          iris luna · admin
        </span>
        <button
          type="button"
          onClick={() => void load()}
          className="text-[10px] uppercase tracking-[0.14em] transition-opacity hover:opacity-70"
          style={{ color: "oklch(0.44 0.024 283)" }}
        >
          refresh
        </button>
      </motion.div>

      {/* Tabs */}
      <div
        className="flex gap-1 mb-6 p-1 rounded-lg"
        style={{ background: "oklch(0.07 0.018 281 / 0.8)" }}
      >
        <TabButton active={tab === "payments"} count={payments.length} onClick={() => setTab("payments")}>
          Payments
        </TabButton>
        <TabButton active={tab === "queue"} count={queue.length} onClick={() => setTab("queue")}>
          Queue
        </TabButton>
      </div>

      <AnimatePresence mode="wait">
        <motion.div
          key={tab}
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.25 }}
          className="flex-1"
        >
          {loading ? (
            <Skeleton />
          ) : tab === "payments" ? (
            <ReadingList rows={payments} emptyHint="No pending payments." />
          ) : (
            <ReadingList rows={queue} emptyHint="Queue is clear." />
          )}
        </motion.div>
      </AnimatePresence>
    </main>
  );
}

function TabButton({
  active,
  count,
  onClick,
  children,
}: {
  active: boolean;
  count: number;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex-1 flex items-center justify-center gap-2 py-2 px-3 rounded-md text-xs uppercase tracking-[0.12em] transition-all duration-200"
      style={{
        background: active ? "oklch(0.52 0.118 283 / 0.25)" : "transparent",
        color: active
          ? "oklch(0.94 0.018 301 / 0.85)"
          : "oklch(0.44 0.024 283)",
      }}
    >
      {children}
      {count > 0 && (
        <span
          className="rounded-full flex items-center justify-center text-[9px] font-mono"
          style={{
            width: 16,
            height: 16,
            background: active
              ? "oklch(0.52 0.118 283 / 0.5)"
              : "oklch(0.44 0.024 283 / 0.3)",
            color: "oklch(0.94 0.018 301 / 0.8)",
          }}
        >
          {count > 9 ? "9+" : count}
        </span>
      )}
    </button>
  );
}

function ReadingList({ rows, emptyHint }: { rows: QueueRow[]; emptyHint: string }) {
  if (rows.length === 0) {
    return (
      <div
        className="flex flex-col items-center justify-center rounded-lg py-16 px-8 text-center"
        style={{ border: "1px dashed oklch(0.94 0.018 301 / 0.08)" }}
      >
        <p className="text-muted text-sm">{emptyHint}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {rows.map((row, i) => (
        <motion.div
          key={row.id}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: i * 0.04, duration: 0.3 }}
        >
          <Link
            href={`/admin/${row.id}`}
            className="flex items-center justify-between px-4 py-3.5 rounded-lg transition-colors duration-150 group"
            style={{ border: "1px solid oklch(0.94 0.018 301 / 0.07)" }}
          >
            <div className="flex flex-col gap-0.5">
              <span
                className="text-[10px] font-mono uppercase tracking-[0.1em]"
                style={{ color: "oklch(0.44 0.024 283 / 0.8)" }}
              >
                {row.id.slice(0, 8)}
              </span>
              <span
                className="text-xs"
                style={{ color: "oklch(0.94 0.018 301 / 0.55)" }}
              >
                {row.spread_type === "single" ? "1-card" : "3-card"} · {timeAgo(row.created_at)}
                {row.email && (
                  <span style={{ color: "oklch(0.44 0.024 283 / 0.6)" }}>
                    {" · "}{row.email}
                  </span>
                )}
              </span>
            </div>
            <span
              className="text-[9px] uppercase tracking-[0.14em] group-hover:opacity-80 transition-opacity"
              style={{ color: "oklch(0.44 0.024 283 / 0.5)" }}
            >
              →
            </span>
          </Link>
        </motion.div>
      ))}
    </div>
  );
}

function Skeleton() {
  return (
    <div className="flex flex-col gap-2">
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          className="h-14 rounded-lg animate-pulse"
          style={{
            background: "oklch(0.07 0.018 281 / 0.6)",
            opacity: 1 - i * 0.2,
          }}
        />
      ))}
    </div>
  );
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}
