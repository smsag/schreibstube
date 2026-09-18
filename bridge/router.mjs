/**
 * Route lookup and authorisation.
 *
 * Both are pure functions over a route table, which is what makes the order of
 * the checks testable. That order matters: the token is checked before the path
 * is acknowledged, so an unauthorised caller cannot map the bridge by probing.
 *
 * A route declares which capability's token opens it. One token therefore never
 * reaches another capability's routes: a mail token on a publish route is
 * refused exactly as a wrong token is, and says as little.
 */
import { timingSafeEqual } from "node:crypto";

/** Which capability the presented credential belongs to, if any. */
export function authenticate(authorizationHeader, tokens) {
  const prefix = "Bearer ";
  const header = authorizationHeader ?? "";
  if (!header.startsWith(prefix)) return null;

  const presented = Buffer.from(header.slice(prefix.length).trim());
  for (const [capability, token] of Object.entries(tokens)) {
    const expected = Buffer.from(token);
    // timingSafeEqual throws on a length mismatch, so compare lengths first —
    // that leaks only the token length, not its content.
    if (presented.length === expected.length && timingSafeEqual(presented, expected)) {
      return capability;
    }
  }
  return null;
}

/**
 * Resolve a request against the table.
 *
 * `capability` is the one the caller authenticated as, or null. The outcomes
 * are deliberately few: an unauthenticated caller and a caller reaching for
 * another capability both get `unauthorized`, and neither learns whether the
 * path exists.
 */
export function resolve(routes, { method, pathname, capability }) {
  const byPath = routes.filter((route) => route.path === pathname);

  const open = byPath.find((route) => route.public);
  if (open) {
    return open.method === method
      ? { outcome: "match", route: open }
      : { outcome: "method-not-allowed" };
  }

  if (!capability) return { outcome: "unauthorized" };
  if (byPath.length === 0) return { outcome: "not-found" };

  const mine = byPath.filter((route) => route.capability === capability);
  if (mine.length === 0) return { outcome: "unauthorized" };

  const match = mine.find((route) => route.method === method);
  return match ? { outcome: "match", route: match } : { outcome: "method-not-allowed" };
}
