import { env } from "@/lib/env";
import { ConsoleEmailSender } from "./console";
import { ResendEmailSender } from "./resend";
import type { EmailSender } from "./types";

export type { EmailMessage, EmailSender } from "./types";

export function getEmailSender(): EmailSender {
  switch (env.emailProvider()) {
    case "resend":
      return new ResendEmailSender(env.resendApiKey(), env.emailFrom());
    case "console":
      return new ConsoleEmailSender();
    default:
      throw new Error(`Unknown EMAIL_PROVIDER "${env.emailProvider()}"`);
  }
}
