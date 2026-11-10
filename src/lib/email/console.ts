import type { EmailMessage, EmailResult, EmailSender } from "./types";

/** Development sender: logs the email instead of delivering it. Set EMAIL_PROVIDER=console. */
export class ConsoleEmailSender implements EmailSender {
  readonly name = "console";
  async send(m: EmailMessage): Promise<EmailResult> {
    console.info(`[email:console] to=${m.to.email} subject="${m.subject}"${m.attachments?.length ? ` attachments=${m.attachments.map((a) => a.filename).join(",")}` : ""}\n${m.text}`);
    return { id: null, provider: this.name };
  }
}
