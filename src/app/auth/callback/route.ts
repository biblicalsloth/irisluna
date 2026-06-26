import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Handles Supabase Auth magic-link callback for admin/reader login.
// The email link lands here with ?code=... which is exchanged for a session.
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const rawNext = searchParams.get("next") ?? "/admin";
  let next = "/admin";
  try {
    const candidate = new URL(rawNext, request.url);
    const here = new URL(request.url);
    if (candidate.origin === here.origin) {
      next = candidate.pathname + candidate.search + candidate.hash;
    }
  } catch { /* keep default */ }

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(new URL(next, request.url));
    }
  }

  // Exchange failed — redirect to login with error hint
  return NextResponse.redirect(new URL("/admin/login?error=1", request.url));
}
