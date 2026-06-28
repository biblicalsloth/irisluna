import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Handles Supabase Auth magic-link callback for admin/reader login.
// The email link lands here with ?code=... which is exchanged for a session.
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const rawNext = searchParams.get("next") ?? "/admin";
  const here = new URL(request.url);
  // Default to a known-safe same-origin path; only accept `next` if it
  // resolves to this exact origin. Redirect to the validated URL directly
  // (no string round-trip) so a protocol-relative path can't slip through.
  let next = new URL("/admin", here);
  try {
    const candidate = new URL(rawNext, here);
    if (candidate.origin === here.origin) {
      next = candidate;
    }
  } catch { /* keep default */ }

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(next);
    }
  }

  // Exchange failed — redirect to login with error hint
  return NextResponse.redirect(new URL("/admin/login?error=1", request.url));
}
