/**
 * Which publish token opens which target.
 *
 * `PUBLISH_TOKEN` opens every target that has no token of its own; a target
 * with `PUBLISH_<TARGET>_TOKEN` is opened by that token alone. A device that
 * publishes one site then carries a token that cannot touch another, and a
 * token handed to a co-author of one site is not a key to all of them.
 *
 * The router has already established that the caller holds some publish
 * token; this decides whether it is the right one for the target asked for.
 */
import { timingSafeEqual } from "node:crypto";

/** The bearer token of an Authorization header, or null. */
export function presentedToken(header) {
  const prefix = "Bearer ";
  const value = typeof header === "string" ? header : "";
  if (!value.startsWith(prefix)) return null;
  const token = value.slice(prefix.length).trim();
  return token.length > 0 ? token : null;
}

/** Constant time, as the router compares: only the length can leak. */
function same(presented, expected) {
  if (typeof presented !== "string" || typeof expected !== "string") return false;
  const a = Buffer.from(presented);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Whether the token presented opens `target`. */
export function opensTarget(publish, target, presented) {
  return same(presented, target.token ?? publish.token);
}
