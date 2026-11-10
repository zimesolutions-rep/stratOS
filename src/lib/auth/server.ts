import { betterAuth } from "better-auth";
import { nextCookies } from "better-auth/next-js";
import { magicLink } from "better-auth/plugins/magic-link";
import { pool } from "@/lib/db";
import { getEmailSender } from "@/lib/email";
import { magicLinkEmail } from "@/lib/email/magic-link";
import { env } from "@/lib/env";

let instance: ReturnType<typeof createAuth> | null = null;

/**
 * Magic-link sign-in. Unlike DealGuard, sign-up is open: StratOS is sold to outside businesses, and a new account
 * lands on onboarding to create its own tenant. Access to an existing tenant only comes from tenant_members.
 */
function createAuth() {
  return betterAuth({
    appName: env.productName(),
    baseURL: env.siteUrl(),
    secret: env.authSecret(),
    database: pool(),
    emailAndPassword: { enabled: false },
    session: { expiresIn: 60 * 60 * 24 * 7, updateAge: 60 * 60 * 24, cookieCache: { enabled: true, maxAge: 5 * 60 } },
    plugins: [
      magicLink({
        expiresIn: 10 * 60,
        async sendMagicLink({ email, url }) {
          await getEmailSender().send({ to: { email }, ...magicLinkEmail(url) });
        },
      }),
      nextCookies(),
    ],
    databaseHooks: {
      user: {
        create: {
          async before(user) {
            return { data: { ...user, email: user.email.toLowerCase(), name: user.name || "" } };
          },
        },
      },
    },
  });
}

/** Lazily built so `next build` works without runtime secrets. */
export function auth() {
  instance ??= createAuth();
  return instance;
}
