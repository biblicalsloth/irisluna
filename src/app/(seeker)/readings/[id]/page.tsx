"use client";

import { useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { getStoredReadings } from "@/lib/session";

// Simple redirect hub — routes to wait or reveal based on stored status.
// Deep-linking /readings/[id] without localStorage falls back to home.
export default function ReadingDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();

  useEffect(() => {
    const reading = getStoredReadings().find((r) => r.readingId === id);

    if (!reading) {
      router.replace("/readings");
      return;
    }

    if (reading.status === "responded" || reading.status === "revealed") {
      router.replace(`/reveal/${id}`);
    } else if (reading.status === "expired") {
      router.replace("/readings");
    } else {
      // pending_payment or awaiting_response
      router.replace(`/wait/${id}`);
    }
  }, [id, router]);

  return null;
}
