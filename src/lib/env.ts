/** Read required environment variables lazily so a missing value fails the request that needs it, with a clear message. */
function required(name: string, value: string | undefined): string {
  if (!value) throw new Error(`Missing environment variable ${name}`);
  return value;
}

export const env = {
  databaseUrl: () => required("DATABASE_URL", process.env.DATABASE_URL),
  authSecret: () => required("BETTER_AUTH_SECRET", process.env.BETTER_AUTH_SECRET),
  siteUrl: () => process.env.NEXT_PUBLIC_SITE_URL ?? process.env.BETTER_AUTH_URL ?? "http://localhost:3000",
  productName: () => process.env.NEXT_PUBLIC_PRODUCT_NAME || "StratOS",
  emailProvider: () => (process.env.EMAIL_PROVIDER ?? "resend").toLowerCase(),
  resendApiKey: () => required("RESEND_API_KEY", process.env.RESEND_API_KEY),
  emailFrom: () => process.env.EMAIL_FROM ?? "StratOS <hello@zimesolutions.com>",
  defaultCountryCode: () => (process.env.DEFAULT_COUNTRY_CODE ?? "91").replace(/\D/g, "") || "91",
};
