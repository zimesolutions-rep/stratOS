import { headers } from "next/headers";
import { auth } from "./server";

/** The verified Better Auth user id for this request, or null. */
export async function currentUserId(): Promise<string | null> {
  const h = await headers(); // read first: marks the route dynamic before any auth setup runs
  const session = await auth().api.getSession({ headers: h });
  return session?.user.id ?? null;
}
