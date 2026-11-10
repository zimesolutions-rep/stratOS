import { NextResponse } from "next/server";
import { z } from "zod";

/** Every route answers in this shape: `{ ok: true, data }` or `{ ok: false, error: { code, message, details? } }`. */
export type ApiSuccess<T> = { ok: true; data: T };
export type ApiFailure = { ok: false; error: { code: string; message: string; details?: unknown } };

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: unknown) {
    super(message);
  }
}

export const ok = <T>(data: T, status = 200) => NextResponse.json<ApiSuccess<T>>({ ok: true, data }, { status });

/** Postgres errors raised by RLS, triggers and constraints, mapped to client errors. */
export function pgError(err: unknown): ApiError | null {
  const e = err as { code?: string; message?: string } | null;
  if (!e || typeof e.code !== "string" || e.code.length !== 5) return null;
  const msg = e.message ?? "Invalid data";
  switch (e.code) {
    case "42501": return new ApiError(403, "forbidden", "You don't have permission to do that");
    case "23514": return new ApiError(422, "constraint_failed", msg);
    case "23505": return new ApiError(409, "conflict", msg);
    case "23503": return new ApiError(422, "invalid_reference", msg);
    case "P0001": return new ApiError(422, "rule_violated", msg);
    case "22P02": case "22007": case "22008": return new ApiError(422, "invalid_value", msg);
    default: return null;
  }
}

export function fail(err: unknown) {
  const mapped = err instanceof ApiError ? err : pgError(err);
  if (mapped) {
    return NextResponse.json<ApiFailure>(
      { ok: false, error: { code: mapped.code, message: mapped.message, details: mapped.details } },
      { status: mapped.status },
    );
  }
  if (err instanceof z.ZodError) {
    return NextResponse.json<ApiFailure>(
      { ok: false, error: { code: "validation_failed", message: err.issues[0]?.message ?? "Invalid request", details: z.flattenError(err) } },
      { status: 422 },
    );
  }
  console.error("[api] unhandled", err instanceof Error ? err.message : "unknown error");
  return NextResponse.json<ApiFailure>({ ok: false, error: { code: "internal_error", message: "Something went wrong" } }, { status: 500 });
}

/** A short message for a server action's form state. */
export function actionError(err: unknown): string {
  if (err instanceof z.ZodError) return err.issues[0]?.message ?? "Check the form";
  const mapped = err instanceof ApiError ? err : pgError(err);
  if (mapped) return mapped.message;
  console.error("[action] unhandled", err instanceof Error ? err.message : "unknown error");
  return "Something went wrong. Try again.";
}
