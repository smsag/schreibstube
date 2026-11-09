/**
 * What is wrong with a publishing account as typed, and the bridge's half of
 * the configuration for all of them.
 *
 * An account is a folder in the vault and a target on the bridge, and the two
 * failures a person could not see coming were both silent: an account missing
 * either is dropped when the settings are next read, and two accounts that
 * share a target or a folder publish over each other. Saying so beside the
 * account, while it is being typed, is cheaper than a site that lost its pages.
 */
import type { PublishAccount } from "../types";
import { isInsideFolder } from "./publish-index";

/** The bridge refuses to start with a target named otherwise. */
const TARGET_NAME = /^[a-z0-9][a-z0-9-]*$/;

export type AccountProblem =
  /** No folder: the account is dropped when the settings are next read. */
  | { kind: "noFolder" }
  /** No target: dropped likewise. */
  | { kind: "noTarget" }
  /** The folder is not in this vault, so a publication finds no notes. */
  | { kind: "folderMissing" }
  /** A name the bridge would refuse at startup. */
  | { kind: "badTarget" }
  /** Another account publishes to the same target; each takes the other's pages down. */
  | { kind: "sameTarget"; other: string }
  /** Another account publishes the same folder. */
  | { kind: "sameFolder"; other: string }
  /** This folder lies inside another account's, whose site publishes these notes too. */
  | { kind: "insideFolder"; other: string }
  /** Another account's folder lies inside this one, so its notes go to this site too. */
  | { kind: "holdsFolder"; other: string };

function folderOf(account: PublishAccount): string {
  return account.folder.trim().replace(/^\/+|\/+$/g, "");
}

function displayName(account: PublishAccount): string {
  return account.name.trim() || folderOf(account) || account.target.trim();
}

/**
 * Every problem with one account, among all of them.
 *
 * `folderExists` is asked only of a folder that is filled in; the vault is the
 * caller's to look at.
 */
export function accountProblems(
  account: PublishAccount,
  accounts: readonly PublishAccount[],
  folderExists: (folder: string) => boolean
): AccountProblem[] {
  const problems: AccountProblem[] = [];
  const folder = folderOf(account);
  const target = account.target.trim();

  if (!folder) problems.push({ kind: "noFolder" });
  else if (!folderExists(folder)) problems.push({ kind: "folderMissing" });
  if (!target) problems.push({ kind: "noTarget" });
  else if (!TARGET_NAME.test(target)) problems.push({ kind: "badTarget" });

  for (const other of accounts) {
    if (other === account || other.id === account.id) continue;
    const name = displayName(other);
    const otherFolder = folderOf(other);

    if (target && other.target.trim() === target)
      problems.push({ kind: "sameTarget", other: name });
    if (!folder || !otherFolder) continue;
    if (otherFolder === folder) problems.push({ kind: "sameFolder", other: name });
    else if (isInsideFolder(folder, otherFolder))
      problems.push({ kind: "insideFolder", other: name });
    else if (isInsideFolder(otherFolder, folder))
      problems.push({ kind: "holdsFolder", other: name });
  }

  return problems;
}

/**
 * Whether an account survives the next read of the settings: the ones that do
 * not are kept in the tab only until Obsidian restarts.
 */
export function isKept(problems: readonly AccountProblem[]): boolean {
  return !problems.some((problem) => problem.kind === "noFolder" || problem.kind === "noTarget");
}

/**
 * The half of the bridge's configuration the vault knows, for every account.
 *
 * One block for all of them, because the bridge reads a single
 * `PUBLISH_TARGETS` list: a block per account, pasted one after the other,
 * left the bridge with whichever list came last. Host, user and credentials
 * are left blank on purpose: they belong to whoever deploys the bridge, and a
 * plausible-looking placeholder would be worse than an obviously empty one.
 */
export function bridgeEnvironment(
  accounts: readonly PublishAccount[],
  fallbackName: string
): string {
  const seen = new Set<string>();
  const sites: { target: string; name: string }[] = [];
  for (const account of accounts) {
    // One line each: a name or a target with a line break in it would end its
    // own line early and start another the bridge reads as a variable.
    const target = oneLine(account.target) || "blog";
    if (seen.has(target)) continue;
    seen.add(target);
    sites.push({ target, name: oneLine(account.name) || fallbackName });
  }
  if (sites.length === 0) sites.push({ target: "blog", name: fallbackName });

  const blocks = sites.map(({ target, name }) => {
    const prefix = `PUBLISH_${target.toUpperCase().replace(/[^A-Z0-9]/g, "_")}`;
    return [
      `${prefix}_HOST=`,
      `${prefix}_PORT=22`,
      `${prefix}_USER=`,
      `${prefix}_PASSWORD=`,
      `${prefix}_HOST_FINGERPRINT=`,
      `${prefix}_ROOT=`,
      `${prefix}_STATE_ROOT=`,
      `${prefix}_BASE_URL=`,
      `${prefix}_SITE_TITLE=${name}`
    ].join("\n");
  });

  return [`PUBLISH_TARGETS=${sites.map((site) => site.target).join(",")}`, ...blocks].join("\n\n");
}

function oneLine(value: string): string {
  return value.replace(/[\r\n]+/g, " ").trim();
}
