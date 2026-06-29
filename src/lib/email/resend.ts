import "server-only";
import { Resend } from "resend";

export const resend = new Resend(process.env.RESEND_API_KEY);

export async function sendReadyEmail(to: string, readingId: string) {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  await resend.emails.send({
    from: "Iris Luna <support@irisluna.cc>",
    to,
    subject: "The human has answered — your reading is ready.",
    html: `
      <div style="background:#0A0A12;color:#ECE9F5;font-family:sans-serif;padding:40px;max-width:480px;margin:auto;border-radius:12px;">
        <h1 style="font-size:24px;margin-bottom:16px;">Your reading is ready.</h1>
        <p style="color:#6C6A82;line-height:1.6;margin-bottom:32px;">
          A human reader has listened to your question and recorded a response.
          Flip your cards when you're ready.
        </p>
        <a href="${appUrl}/reveal/${readingId}"
           style="background:#7C6FCB;color:#ECE9F5;padding:14px 28px;border-radius:8px;text-decoration:none;display:inline-block;">
          Reveal your reading →
        </a>
      </div>
    `,
  });
}
