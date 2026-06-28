import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const CODE_RE = /^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/;
const MAX_ATTEMPTS = 10;

// Seeker-facing — no auth. Restores a whole garden from its code.
// Card identities and audio paths are NEVER returned (seal preserved).
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { garden_code } = await req.json() as { garden_code?: string };
    if (!garden_code || !CODE_RE.test(garden_code.toUpperCase())) {
      return json({ error: "Invalid code format" }, 400);
    }

    const codeHash = await hashCode(garden_code.toUpperCase());
    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );

    const { data: seeker, error } = await admin
      .from("seekers").select("id, restore_attempts").eq("garden_code_hash", codeHash).single();

    if (error || !seeker) return json({ error: "No garden found for that code" }, 404);
    if (seeker.restore_attempts >= MAX_ATTEMPTS) {
      return json({ error: "Code is locked after too many failed attempts" }, 429);
    }

    await admin.from("seekers")
      .update({ restore_attempts: seeker.restore_attempts + 1 }).eq("id", seeker.id);

    const { data: readings } = await admin
      .from("readings")
      .select("id, session_token, status, spread_type, created_at")
      .eq("seeker_id", seeker.id)
      .order("created_at", { ascending: true });

    return json({
      seeker_id: seeker.id,
      readings: (readings ?? []).map((r) => ({
        reading_id: r.id,
        session_token: r.session_token,
        status: r.status,
        spread_type: r.spread_type,
        created_at: r.created_at,
      })),
    });
  } catch (err) {
    console.error("restore_garden error:", err);
    return json({ error: "Internal server error" }, 500);
  }
});

async function hashCode(code: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(code));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
