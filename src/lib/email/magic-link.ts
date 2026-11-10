import { escapeHtml } from "@/lib/html";
import { env } from "@/lib/env";
import type { EmailMessage } from "./types";

export function magicLinkEmail(url: string): Omit<EmailMessage, "to"> {
  const safe = escapeHtml(url);
  const product = escapeHtml(env.productName());
  return {
    subject: `Your ${env.productName()} sign-in link`,
    text: `Sign in to ${env.productName()}: ${url}\n\nThe link works once and expires in 10 minutes. If you didn't ask for it, ignore this email.`,
    html: `<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0;padding:24px;background:#F8FAFC;font-family:Arial,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
<table role="presentation" width="100%" style="max-width:480px;background:#fff;border:1px solid #E2E8F0;border-radius:14px">
<tr><td style="padding:28px">
<p style="margin:0 0 4px;font:700 18px/1.3 Arial,sans-serif;color:#0F172A">Sign in to ${product}</p>
<p style="margin:0 0 20px;font:400 14px/1.6 Arial,sans-serif;color:#334155">Use the button below. It works once and expires in 10 minutes.</p>
<a href="${safe}" style="display:inline-block;padding:12px 24px;border-radius:999px;background:#7A2EDB;color:#fff;font:700 14px/1 Arial,sans-serif;text-decoration:none">Sign in</a>
<p style="margin:20px 0 0;font:400 12px/1.6 Arial,sans-serif;color:#64748B">If you didn't ask for this, you can ignore it.</p>
</td></tr></table></td></tr></table></body></html>`,
  };
}
