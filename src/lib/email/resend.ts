import type { EmailMessage, EmailResult, EmailSender } from "./types";

/** Resend over its REST API (no SDK needed). https://resend.com/docs/api-reference/emails/send-email */
export class ResendEmailSender implements EmailSender {
  readonly name = "resend";
  constructor(private readonly apiKey: string, private readonly from: string) {}

  async send(m: EmailMessage): Promise<EmailResult> {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: this.from,
        to: [m.to.name ? `${m.to.name.replace(/[<>"]/g, "")} <${m.to.email}>` : m.to.email],
        subject: m.subject,
        html: m.html,
        text: m.text,
        reply_to: m.replyTo,
        tags: m.tags ? Object.entries(m.tags).map(([name, value]) => ({ name, value })) : undefined,
        attachments: m.attachments?.map((a) => ({ filename: a.filename, path: a.url })),
      }),
      signal: AbortSignal.timeout(15_000),
    });
    const body = (await res.json().catch(() => ({}))) as { id?: string; message?: string };
    if (!res.ok) throw new Error(`Resend ${res.status}: ${body.message ?? "send failed"}`);
    return { id: body.id ?? null, provider: this.name };
  }
}
