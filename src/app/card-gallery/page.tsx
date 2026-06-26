"use client";

import { useEffect, useState } from "react";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

interface Card {
  id: number;
  name: string;
  arcana: string;
  suit: string | null;
  image_path: string | null;
}

const BASE = process.env.NEXT_PUBLIC_SUPABASE_URL;

export default function CardGallery() {
  const [cards, setCards] = useState<Card[]>([]);

  useEffect(() => {
    supabase
      .from("cards")
      .select("id, name, arcana, suit, image_path")
      .order("id")
      .then(({ data }) => setCards(data ?? []));
  }, []);

  const major = cards.filter((c) => c.arcana === "major");
  const suits = ["wands", "cups", "swords", "pentacles"];

  function imgUrl(path: string | null) {
    if (!path || !BASE) return null;
    return `${BASE}/storage/v1/object/public/card-art/${path}`;
  }

  function CardThumb({ card }: { card: Card }) {
    const src = imgUrl(card.image_path);
    return (
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
        <div style={{ width: 80, height: 130, borderRadius: 6, overflow: "hidden", background: "#12121E", border: "1px solid rgba(124,111,203,0.2)" }}>
          {src ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={src} alt={card.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
          ) : (
            <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <span style={{ fontSize: 8, color: "rgba(183,174,234,0.3)" }}>no art</span>
            </div>
          )}
        </div>
        <span style={{ fontSize: 8, color: "rgba(183,174,234,0.5)", textAlign: "center", maxWidth: 80 }}>{card.name}</span>
      </div>
    );
  }

  function Section({ title, group }: { title: string; group: Card[] }) {
    return (
      <div style={{ marginBottom: 40 }}>
        <p style={{ fontSize: 10, letterSpacing: "0.2em", textTransform: "uppercase", color: "rgba(124,111,203,0.6)", marginBottom: 16 }}>{title}</p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
          {group.map((c) => <CardThumb key={c.id} card={c} />)}
        </div>
      </div>
    );
  }

  if (!cards.length) {
    return (
      <main style={{ minHeight: "100dvh", background: "#0A0A12", color: "#ECE9F5", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <p style={{ fontStyle: "italic", opacity: 0.4 }}>loading cards…</p>
      </main>
    );
  }

  return (
    <main style={{ minHeight: "100dvh", background: "#0A0A12", color: "#ECE9F5", padding: "40px 32px" }}>
      <h1 style={{ fontSize: 20, fontStyle: "italic", marginBottom: 8, opacity: 0.7 }}>iris luna — card gallery</h1>
      <p style={{ fontSize: 11, opacity: 0.3, marginBottom: 40 }}>{cards.length} cards</p>
      <Section title="Major Arcana" group={major} />
      {suits.map((suit) => (
        <Section key={suit} title={suit.charAt(0).toUpperCase() + suit.slice(1)} group={cards.filter((c) => c.suit === suit)} />
      ))}
    </main>
  );
}
