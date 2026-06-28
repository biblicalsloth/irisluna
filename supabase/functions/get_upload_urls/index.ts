import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const ALLOWED_AUDIO_EXT = new Set(["webm", "mp4"]);

function isCleanExt(ext: unknown): ext is string {
  return typeof ext === "string" && /^[a-z0-9]{1,10}$/.test(ext);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body = await req.json() as { question_audio_ext?: unknown };
    const rawAudioExt = body.question_audio_ext ?? "webm";

    if (!isCleanExt(rawAudioExt) || !ALLOWED_AUDIO_EXT.has(rawAudioExt)) {
      return json({ error: "Invalid audio extension" }, 400);
    }

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );

    const audioPath = `${crypto.randomUUID()}.${rawAudioExt}`;
    const audioResult = await admin.storage
      .from("question-audio")
      .createSignedUploadUrl(audioPath);

    if (audioResult.error) {
      console.error("upload URL error:", audioResult.error);
      return json({ error: "Failed to create upload URL" }, 500);
    }

    return json({
      question_audio: { upload_url: audioResult.data.signedUrl, path: audioPath },
    });
  } catch (err) {
    console.error("get_upload_urls error:", err);
    return json({ error: "Internal server error" }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
