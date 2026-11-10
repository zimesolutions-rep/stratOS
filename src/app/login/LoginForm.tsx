"use client";

import { useActionState } from "react";
import { sendMagicLink, type LoginState } from "./actions";

export function LoginForm({ next, email }: { next: string; email: string }) {
  const [state, action, pending] = useActionState<LoginState, FormData>(sendMagicLink, {});
  if (state.sent) {
    return (
      <div className="rounded-xl bg-ok-soft p-4 text-sm text-ok">
        A sign-in link is on its way to <strong>{state.sent}</strong>. It expires in 10 minutes.
      </div>
    );
  }
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="next" value={next} />
      <div>
        <label htmlFor="email" className="label">Work email</label>
        <input id="email" name="email" type="email" autoComplete="email" required defaultValue={email} className="input" placeholder="you@company.com" />
      </div>
      {state.error && <p className="field-error" role="alert">{state.error}</p>}
      <button className="btn w-full" disabled={pending}>{pending ? "Sending…" : "Email me a sign-in link"}</button>
    </form>
  );
}
