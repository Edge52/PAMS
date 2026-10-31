import "server-only";
import { can, type Permission } from "./permissions";
import { getCurrentUser } from "./session";

/** For route handlers (downloads, files, JSON): a 401/403 response, or null when the request may go ahead. */
export async function routeGuard(permission?: Permission): Promise<Response | null> {
  const me = await getCurrentUser();
  if (!me) return new Response("Sign in first.", { status: 401 });
  if (permission && !can(me.role, permission)) return new Response("Your role doesn't allow this.", { status: 403 });
  return null;
}
