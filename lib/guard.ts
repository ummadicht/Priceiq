import { redirect } from "next/navigation";
import { currentUserId, loginUrl, authDisabled } from "./superiqAuth.ts";

/**
 * One call at the top of every page.
 *
 * Server-side redirect rather than a client-side check: a dashboard that paints
 * before bouncing has already shown the numbers to whoever loaded it.
 */
export async function requireSuperIQ(returnTo: string): Promise<string> {
  if (authDisabled()) return "dev";
  const user = await currentUserId();
  if (!user) redirect(loginUrl(returnTo));
  return user;
}
