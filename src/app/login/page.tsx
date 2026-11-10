import { Logo } from "@/components/Logo";
import { LoginForm } from "./LoginForm";

export const metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; error?: string; email?: string }> }) {
  const { next = "/dashboard", error, email } = await searchParams;
  return (
    <div className="grid min-h-screen lg:grid-cols-[1fr_1.1fr]">
      <div className="flex flex-col justify-center px-6 py-12 sm:px-12">
        <div className="mx-auto w-full max-w-sm">
          <Logo />
          <h1 className="mt-10 text-3xl font-extrabold text-ink">Sign in</h1>
          <p className="mb-6 mt-2 text-sm text-ink-3">Leads, calls, follow-ups and tickets in one workspace, with an AI assistant beside you.</p>
          {error && <p className="field-error mb-4" role="alert">That sign-in link has expired. Request a new one.</p>}
          <LoginForm next={next} email={email ?? ""} />
          <p className="mt-4 text-xs text-ink-3">New here? Sign in with your work email and you can set up your workspace next.</p>
        </div>
      </div>
      <div className="hidden p-4 lg:block">
        <section className="flex h-full flex-col justify-end rounded-[28px] bg-chrome p-10 text-chrome-ink">
          <div className="eyebrow !text-chrome-muted">Ambient AI CRM</div>
          <p className="mt-3 max-w-md font-heading text-3xl font-extrabold leading-tight text-white">
            Every lead scored, every follow-up on time, and nothing sent to someone who said stop.
          </p>
        </section>
      </div>
    </div>
  );
}
