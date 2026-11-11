/** Mirrors the enums in db/migrations/0002_stratos_core.sql. Keep the two in step. */

export const INDUSTRIES = ["digital_marketing_agency", "it_consulting_saas", "recruitment_staffing", "tech_support"] as const;
export type Industry = (typeof INDUSTRIES)[number];
export const INDUSTRY_LABEL: Record<Industry, string> = {
  digital_marketing_agency: "Digital marketing agency",
  it_consulting_saas: "IT consulting / SaaS",
  recruitment_staffing: "Recruitment / staffing",
  tech_support: "Tech support",
};

export const MEMBER_ROLES = ["owner", "admin", "sales_rep", "support_agent", "viewer"] as const;
export type MemberRole = (typeof MEMBER_ROLES)[number];
export const ROLE_LABEL: Record<MemberRole, string> = {
  owner: "Owner", admin: "Admin", sales_rep: "Sales rep", support_agent: "Support agent", viewer: "Viewer",
};
export const canWrite = (r: MemberRole) => r !== "viewer";
export const isAdminRole = (r: MemberRole) => r === "owner" || r === "admin";

export const LEAD_SOURCES = ["facebook_lead_ads", "instagram_lead_ads", "google_my_business", "google_ads_lead_form", "website_form", "whatsapp", "telecmi", "referral", "manual", "api"] as const;
export type LeadSource = (typeof LEAD_SOURCES)[number];
export const SOURCE_LABEL: Record<LeadSource, string> = {
  facebook_lead_ads: "Facebook Lead Ads", instagram_lead_ads: "Instagram Lead Ads", google_my_business: "Google Business", google_ads_lead_form: "Google Ads lead form",
  website_form: "Website form", whatsapp: "WhatsApp", telecmi: "Phone call", referral: "Referral", manual: "Added by hand", api: "API",
};

export const LEAD_STATUSES = ["active", "won", "lost", "unsubscribed", "archived"] as const;
export type LeadStatus = (typeof LEAD_STATUSES)[number];

export const CONSENT_STATUSES = ["unknown", "granted", "withdrawn", "erasure_requested"] as const;
export type ConsentStatus = (typeof CONSENT_STATUSES)[number];
export const CONSENT_LABEL: Record<ConsentStatus, string> = {
  unknown: "Not recorded", granted: "Granted", withdrawn: "Withdrawn", erasure_requested: "Erasure requested",
};

/** Names for scoring events (rule keys that are not "source:…"). */
export const SCORE_EVENT_LABEL: Record<string, string> = {
  call_answered: "Picks up a call", call_missed: "Misses an outbound call", inbound_reply: "Replies",
  re_enquiry: "Enquires again", sentiment_positive: "Positive call", sentiment_neutral: "Neutral call",
  sentiment_negative: "Negative call", inactivity_48h: "Idle for 48 hours", stage_floor: "Moved to a new stage",
};
export const STEP_CHANNEL_LABEL: Record<string, string> = { whatsapp: "WhatsApp", sms: "SMS", email: "Email", call_task: "Call task" };

/** Privacy laws a workspace can declare. HIPAA also turns on strict masking of health details before AI calls. */
export const REGIMES = ["dpdp", "gdpr", "uk_gdpr", "ccpa", "hipaa", "uae_pdpl", "ksa_pdpl", "au_privacy", "pdpa_sg"] as const;
export type Regime = (typeof REGIMES)[number];
export const REGIME_LABEL: Record<Regime, string> = {
  dpdp: "DPDP Act (India)", gdpr: "GDPR (EU)", uk_gdpr: "UK GDPR", ccpa: "CCPA / CPRA (California)",
  hipaa: "HIPAA (US health data)", uae_pdpl: "PDPL (UAE)", ksa_pdpl: "PDPL (Saudi Arabia)",
  au_privacy: "Privacy Act (Australia)", pdpa_sg: "PDPA (Singapore)",
};

/** Where a workspace's customers are. Picking a market suggests its privacy laws; health data adds HIPAA by hand. */
export const MARKETS = ["in", "us", "eu", "uk", "me", "au", "sea", "other"] as const;
export type Market = (typeof MARKETS)[number];
export const MARKET_LABEL: Record<Market, string> = {
  in: "India", us: "United States", eu: "European Union", uk: "United Kingdom", me: "Middle East (UAE, Saudi Arabia)",
  au: "Australia", sea: "Singapore and South-East Asia", other: "Elsewhere",
};
export const MARKET_REGIMES: Record<Market, Regime[]> = {
  in: ["dpdp"], us: ["ccpa"], eu: ["gdpr"], uk: ["uk_gdpr"], me: ["uae_pdpl", "ksa_pdpl"], au: ["au_privacy"],
  sea: ["pdpa_sg"], other: [],
};

export type Tenant = {
  id: string; name: string; slug: string; industry: Industry; compliance_regimes: Regime[]; customer_markets: Market[];
  data_region: "in" | "eu" | "us"; default_currency: string; timezone: string; retention_days: number | null;
};
export type Membership = { tenant_id: string; tenant_name: string; slug: string; role: MemberRole };

export type Stage = { id: string; key: string; name: string; position: number; probability: number; is_won: boolean; is_lost: boolean };

export type Lead = {
  id: string; full_name: string | null; email: string | null; phone: string | null; company: string | null; job_title: string | null;
  source: LeadSource; stage_id: string | null; status: LeadStatus; owner_id: string | null; contract_value: number | null; currency: string;
  conversion_probability: number; baseline_probability: number; last_activity_at: string; consent_status: ConsentStatus;
  consent_updated_at: string | null; contains_phi: boolean; created_at: string;
};

export type ScoreEvent = { id: number; rule_key: string; delta: number; score_before: number; score_after: number; created_at: string };
