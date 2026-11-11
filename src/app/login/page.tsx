import { Logo } from "@/components/Logo";
import { LoginForm } from "./LoginForm";

export const metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; error?: string; email?: string }> }) {
  const { next = "/dashboard", error, email } = await searchParams;
  return (
    <div className="grid min-h-screen lg:grid-cols-[1fr_1.1fr]">
      <div className="flex flex-col justify-center px-6 py-12 sm:px-12">
        <div className="mx-auto w-full max-w-sm">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/illustrations/happy-garden.svg" alt="" className="mb-8 h-40 w-full rounded-[20px] object-cover object-bottom lg:hidden" />
          <Logo />
          <h1 className="mt-10 text-3xl font-extrabold text-ink">Sign in</h1>
          <p className="mb-6 mt-2 text-sm text-ink-3">Leads, calls, follow-ups and tickets in one workspace, with an AI assistant beside you.</p>
          {error && <p className="field-error mb-4" role="alert">That sign-in link has expired. Request a new one.</p>}
          <LoginForm next={next} email={email ?? ""} />
          <p className="mt-4 text-xs text-ink-3">New here? Sign in with your work email and you can set up your workspace next.</p>
        </div>
      </div>
      <div className="hidden p-4 lg:block">
        {/* Happy Life: a garden at sunrise (sibling of myHR's park illustration), copy on the open sky. */}
        <section className="relative h-full overflow-hidden rounded-[28px] bg-[#EDE4FF]">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/illustrations/happy-garden.svg" alt="" className="absolute inset-0 h-full w-full object-cover object-bottom" />
          <div className="relative p-10 xl:p-12">
            <div className="eyebrow">Happy Life</div>
            <p className="mt-3 max-w-md font-heading text-3xl font-extrabold leading-tight text-ink">
              Warmer conversations, fewer chases, and evenings that are yours again.
            </p>
            <p className="mt-3 max-w-md text-sm text-ink-2">
              Every lead scored, every follow-up on time, and nothing sent to someone who said stop.
            </p>
          </div>
        </section>
      </div>
    </div>
  );
}
