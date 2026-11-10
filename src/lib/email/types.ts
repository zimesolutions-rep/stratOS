export type EmailMessage = {
  to: { email: string; name?: string | null };
  subject: string;
  html: string;
  text: string;
  replyTo?: string;
  tags?: Record<string, string>;
  /** Files fetched by the provider from a (short-lived) URL. */
  attachments?: { filename: string; url: string }[];
};

export type EmailResult = { id: string | null; provider: string };

/** Anything that can deliver a transactional email. Swap providers by adding an implementation. */
export interface EmailSender {
  readonly name: string;
  send(message: EmailMessage): Promise<EmailResult>;
}
