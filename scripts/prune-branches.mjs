/**
 * Delete the branches whose work is done, and say which ones were left.
 *
 * Every change arrives on a branch and a pull request, and nothing took the
 * branch away afterwards: by 1.88.2 the repository held nearly two hundred,
 * most of them for work merged months before, which buried the few that
 * still meant something. This runs after each release and once a week.
 *
 * A branch is deleted only when nothing on it can be lost:
 *
 * - its tip is part of the default branch, so every commit is already there;
 * - or a pull request from it was merged, squashed or rebased, which is how
 *   most branches end and why their commits are not ancestors of `main`;
 * - or its pull requests were closed unmerged more than a grace period ago,
 *   long enough for a reopening that was going to happen.
 *
 * Anything else stays: a branch with an open pull request, one closed only
 * recently, and one that never had a pull request — work in progress, or
 * someone's experiment — which is listed in the run's summary for a person.
 * A deleted branch is not gone: GitHub keeps every pull request's commits and
 * offers "Restore branch" on it.
 *
 * Plain Node and `fetch`, no dependencies: the job holds a token that can
 * delete branches, so it installs nothing and runs no one else's code.
 */

/** How long a pull request closed without merging keeps its branch. */
export const CLOSED_GRACE_DAYS = 7;

/**
 * What to do with one branch.
 *
 * `compare` is how the branch's tip relates to the default branch, as the
 * compare API says it: `identical` or `behind` mean every commit is there.
 * `prs` are the pull requests whose head was this branch, open ones included.
 */
export function decide({
  branch,
  defaultBranch,
  protectedBranch,
  compare,
  prs,
  now,
  graceDays = CLOSED_GRACE_DAYS
}) {
  if (branch === defaultBranch) return { action: "keep", reason: "default branch" };
  if (protectedBranch) return { action: "keep", reason: "protected" };
  if (prs.some((pr) => pr.state === "open")) return { action: "keep", reason: "open pull request" };
  if (compare === "identical" || compare === "behind") {
    return { action: "delete", reason: "contained in the default branch" };
  }

  const merged = prs.find((pr) => pr.mergedAt !== null);
  if (merged) return { action: "delete", reason: `pull request #${merged.number} merged` };

  if (prs.length > 0) {
    const lastClosed = Math.max(...prs.map((pr) => Date.parse(pr.closedAt ?? "") || 0));
    const age = (now.getTime() - lastClosed) / 86_400_000;
    const numbers = prs.map((pr) => `#${pr.number}`).join(", ");
    return age >= graceDays
      ? { action: "delete", reason: `pull request ${numbers} closed unmerged` }
      : { action: "keep", reason: `pull request ${numbers} closed ${Math.floor(age)} day(s) ago` };
  }

  return { action: "report", reason: "no pull request and not merged" };
}

/** Whether the compare API's answer has to be asked for: only when no pull request already settles it. */
export function needsCompare(prs) {
  return !prs.some((pr) => pr.state === "open" || pr.mergedAt !== null);
}

/** The run's summary, as Markdown for the job page. */
export function summarize(results, dryRun) {
  const by = (action) => results.filter((result) => result.action === action);
  const lines = [
    `## Branches${dryRun ? " (dry run: nothing deleted)" : ""}`,
    "",
    `${by("delete").length} deleted, ${by("keep").length} kept, ${by("report").length} left for a person.`
  ];
  const report = by("report");
  if (report.length > 0) {
    lines.push(
      "",
      "Never had a pull request and are not merged; delete them by hand if they are done:",
      ""
    );
    for (const result of report) lines.push(`- \`${result.branch}\``);
  }
  const deleted = by("delete");
  if (deleted.length > 0) {
    lines.push("", "<details><summary>Deleted</summary>", "");
    for (const result of deleted) lines.push(`- \`${result.branch}\`: ${result.reason}`);
    lines.push("", "</details>");
  }
  return `${lines.join("\n")}\n`;
}

async function main() {
  const repo = process.env.GITHUB_REPOSITORY;
  const token = process.env.GITHUB_TOKEN;
  const dryRun = process.env.DRY_RUN === "true";
  if (!repo || !token) throw new Error("GITHUB_REPOSITORY and GITHUB_TOKEN are required.");

  const api = async (path, init = {}) => {
    const response = await fetch(`https://api.github.com/repos/${repo}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28"
      },
      signal: AbortSignal.timeout(30_000)
    });
    if (!response.ok) throw new Error(`${init.method ?? "GET"} ${path}: HTTP ${response.status}`);
    return response.status === 204 ? null : response.json();
  };
  const all = async (path) => {
    const items = [];
    for (let page = 1; page <= 50; page += 1) {
      const batch = await api(`${path}${path.includes("?") ? "&" : "?"}per_page=100&page=${page}`);
      items.push(...batch);
      if (batch.length < 100) return items;
    }
    return items;
  };

  const { default_branch: defaultBranch } = await api("");
  const branches = await all("/branches");
  const pulls = (await all("/pulls?state=all")).filter((pr) => pr.head?.repo?.full_name === repo);
  const prsOf = new Map();
  for (const pr of pulls) {
    const list = prsOf.get(pr.head.ref) ?? [];
    list.push({
      number: pr.number,
      state: pr.state,
      mergedAt: pr.merged_at,
      closedAt: pr.closed_at
    });
    prsOf.set(pr.head.ref, list);
  }

  const results = [];
  for (const { name, protected: protectedBranch } of branches) {
    const prs = prsOf.get(name) ?? [];
    const compare =
      name !== defaultBranch && !protectedBranch && needsCompare(prs)
        ? (await api(`/compare/${encodeURIComponent(defaultBranch)}...${encodeURIComponent(name)}`))
            .status
        : null;
    const verdict = decide({
      branch: name,
      defaultBranch,
      protectedBranch,
      compare,
      prs,
      now: new Date()
    });
    results.push({ branch: name, ...verdict });
    if (verdict.action === "delete" && !dryRun) {
      await api(`/git/refs/heads/${name.split("/").map(encodeURIComponent).join("/")}`, {
        method: "DELETE"
      });
    }
    console.log(`${verdict.action.padEnd(6)} ${name}: ${verdict.reason}`);
  }

  const summary = summarize(results, dryRun);
  if (process.env.GITHUB_STEP_SUMMARY) {
    const { appendFile } = await import("node:fs/promises");
    await appendFile(process.env.GITHUB_STEP_SUMMARY, summary);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
