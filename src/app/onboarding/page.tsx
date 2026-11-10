import { redirect } from "next/navigation";
import { Logo } from "@/components/Logo";
import { currentUserId } from "@/lib/auth/current-user";
import { asTenantUser } from "@/lib/db";
import { OnboardingForm } from "./OnboardingForm";

export const metadata = { title: "Set up your workspace" };
export const dynamic = "force-dynamic";

export default async function OnboardingPage({ searchParams }: { searchParams: Promise<{ new?: string }> }) {
  const userId = await currentUserId();
  if (!userId) redirect("/login?next=/onboarding");
  const { new: another } = await searchParams;
  if (!another) {
    const has = await asTenantUser(userId, null, async (db) => (await db.query(
      "select 1 from stratos.tenant_members where user_id = $1 and active limit 1", [userId])).rowCount);
    if (has) redirect("/dashboard");
  }
  return (
    <div className="min-h-screen px-4 py-10 sm:px-6">
      <div className="mx-auto max-w-3xl">
        <Logo />
        <div className="card mt-8">
          <div className="eyebrow mb-1">{another ? "New workspace" : "Welcome"}</div>
          <h1 className="h1">Set up your workspace</h1>
          <p className="mb-6 mt-1 text-sm text-ink-3">One workspace per business. Everything in it, from leads to call recordings, stays inside it.</p>
          <OnboardingForm />
        </div>
      </div>
    </div>
  );
}
