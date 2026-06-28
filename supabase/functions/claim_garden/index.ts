import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body = await req.json() as {
      reading_id?: string;
      session_token?: string;
      email?: string;
    };
    const { reading_id, session_token, email } = body;

    if (!reading_id || !session_token || !UUID.test(reading_id) || !UUID.test(session_token)) {
      return json({ error: "Invalid request" }, 400);
    }

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );

    const { data: reading, error: readErr } = await admin
      .from("readings")
      .select("id, session_token, status, paid_at, seeker_id, spread_type, garden_code")
      .eq("id", reading_id)
      .single();

    if (readErr || !reading) return json({ error: "Reading not found" }, 404);
    if (reading.session_token !== session_token) return json({ error: "Forbidden" }, 403);
    if (!reading.paid_at) return json({ error: "not_paid" }, 409);

    let seekerId = reading.seeker_id as string | null;
    let gardenCode = reading.garden_code as string | null;
    let isNewGarden = false;
    let species = "iris";

    if (!seekerId) {
      // First reading: mint garden + key now (post-payment).
      gardenCode = generateGardenCode();
      const gardenCodeHash = await hashCode(gardenCode);
      const { data: seeker, error: seekerErr } = await admin
        .from("seekers").insert({ garden_code_hash: gardenCodeHash }).select("id").single();
      if (seekerErr || !seeker) {
        console.error("insert seeker error:", seekerErr);
        return json({ error: "Failed to create garden" }, 500);
      }

      // Atomic claim: only attach if the reading is still unclaimed. Guards
      // against two concurrent first-calls minting two gardens.
      const { data: claimed, error: updErr } = await admin
        .from("readings")
        .update({ seeker_id: seeker.id, garden_code: gardenCode })
        .eq("id", reading.id)
        .is("seeker_id", null)
        .select("seeker_id, garden_code")
        .maybeSingle();
      if (updErr) {
        console.error("attach seeker error:", updErr);
        return json({ error: "Failed to bind garden" }, 500);
      }

      if (claimed) {
        seekerId = seeker.id;
        isNewGarden = true;
        species = "iris"; // namesake flower for a brand-new garden
      } else {
        // Lost the race: another call already attached a garden. Drop our
        // orphan seeker and use the winner's values.
        await admin.from("seekers").delete().eq("id", seeker.id);
        const { data: fresh } = await admin
          .from("readings").select("seeker_id, garden_code").eq("id", reading.id).single();
        seekerId = fresh?.seeker_id ?? null;
        gardenCode = fresh?.garden_code ?? null;
        isNewGarden = false;
      }
    }

    if (!isNewGarden) {
      // Returning/idempotent path: species from the primary card.
      const { data: primaryCard } = await admin
        .from("reading_cards").select("card_id").eq("reading_id", reading.id).eq("position", 0).single();
      if (primaryCard) {
        const { data: card } = await admin
          .from("cards").select("flower_species").eq("id", primaryCard.card_id).single();
        species = card?.flower_species ?? "iris";
      }
    }

    if (email && EMAIL_RE.test(email) && gardenCode) {
      await sendCodeEmail(email, gardenCode).catch((e) =>
        console.error("email send failed:", e)
      );
    }

    return json({
      paid: true,
      is_new_garden: isNewGarden,
      garden_code: gardenCode,
      species,
      spread_type: reading.spread_type,
      seeker_id: seekerId,
      status: reading.status,
    });
  } catch (err) {
    console.error("claim_garden error:", err);
    return json({ error: "Internal server error" }, 500);
  }
});

async function hashCode(code: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(code));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function generateGardenCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  const raw = Array.from(bytes).map((b) => chars[b % chars.length]).join("");
  return `${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8)}`;
}

async function sendCodeEmail(to: string, code: string): Promise<void> {
  const apiKey = Deno.env.get("RESEND_API_KEY");
  if (!apiKey) {
    console.error("RESEND_API_KEY missing; skipping email");
    return;
  }
  const appUrl = Deno.env.get("APP_URL") ?? Deno.env.get("NEXT_PUBLIC_APP_URL") ?? "http://localhost:3000";
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: "Iris Luna <readings@irisluna.app>",
      to,
      subject: "Your garden key",
      html: `
        <div style="background:#0A0A12;color:#ECE9F5;font-family:sans-serif;padding:40px;max-width:480px;margin:auto;border-radius:12px;">
          <h1 style="font-size:22px;margin-bottom:16px;">Your garden key</h1>
          <p style="color:#6C6A82;line-height:1.6;margin-bottom:24px;">
            Keep this safe. Enter it any time to return to your garden and your past readings.
          </p>
          <p style="font-size:28px;letter-spacing:6px;font-family:monospace;color:#B7AEEA;margin-bottom:28px;">
            ${code}
          </p>
          <a href="${appUrl}/recover"
             style="background:#7C6FCB;color:#ECE9F5;padding:14px 28px;border-radius:8px;text-decoration:none;display:inline-block;">
            Open my garden →
          </a>
        </div>
      `,
    }),
  });
  if (!res.ok) {
    console.error("resend error:", res.status, await res.text());
  }
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
