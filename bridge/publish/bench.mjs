/**
 * How long a publish takes, and how many SFTP requests it spends.
 *
 *   node publish/bench.mjs [notes=300] [latency ms=10]
 *
 * The routes run in this process against the test SFTP server, which answers
 * every request `latency` milliseconds late — about the distance from a
 * hosting platform to a web host in the same country. What it cannot show is
 * the SSH handshake, which is local here and a few hundred milliseconds on a
 * real line; every upload pays one, the commit one.
 *
 * Wall time depends on the machine; the request count does not, and is the
 * number to compare between two versions of the bridge.
 */
import { createHash } from "node:crypto";
import { startSftpServer } from "./sftp-fixture.mjs";
import { createPublishRoutes } from "./routes.mjs";

const NOTES = Number(process.argv[2] ?? 300);
const LATENCY_MS = Number(process.argv[3] ?? 10);

const sha256 = (value) => createHash("sha256").update(value).digest("hex");

function source(i, edit = 0) {
  const others = [1, 2, 3].map((step) => `[[Notiz ${(i + step) % NOTES}]]`).join(", ");
  const paragraph =
    "Ein Absatz, lang genug, um wie Text auszusehen, mit *Betonung* und `Code`. ".repeat(6);
  return (
    `---\ntitle: Notiz ${i}\n---\n# Notiz ${i}${edit ? ` (Fassung ${edit})` : ""}\n\n` +
    `${paragraph}\n\nSiehe ${others}.\n\n${paragraph}\n`
  );
}

function indexFor(sources) {
  return {
    siteTitle: "Bench",
    assets: [],
    notes: sources.map((text, i) => ({
      sourcePath: `Blog/Notiz ${i}.md`,
      sha256: sha256(text),
      slug: `notiz-${i}`,
      title: `Notiz ${i}`,
      date: `2026-09-${String((i % 28) + 1).padStart(2, "0")}`
    }))
  };
}

const sftp = await startSftpServer({ latencyMs: LATENCY_MS });
const config = {
  requestTimeoutMs: 30_000,
  upstreamTimeoutMs: 20_000,
  publish: {
    maxSourceBytes: 2_000_000,
    maxImageBytes: 10_000_000,
    maxVideoBytes: 25_000_000,
    maxIndexBytes: 4_000_000,
    maxFiles: 10_000,
    targets: {
      bench: {
        name: "bench",
        host: "127.0.0.1",
        port: sftp.port,
        user: sftp.user,
        password: sftp.password,
        fingerprint: sftp.fingerprint,
        root: "/site",
        stateRoot: "/state",
        stateInsideRoot: false,
        baseUrl: "https://bench.example.com",
        siteTitle: "Bench",
        allowHtml: true,
        allowDiagrams: false,
        assetExtensions: new Set(["png"])
      }
    }
  }
};

let routes = createPublishRoutes(config, { version: "bench" });
const call = (method, path, request) =>
  routes
    .find((route) => route.method === method && route.path === path)
    .handler({ log: () => {}, requestId: "bench", query: new URLSearchParams(), ...request });

/** What the plugin does: plan, upload what is missing, commit. */
async function publish(sources) {
  const index = indexFor(sources);
  const plan = await call("POST", "/publish/plan", { body: { target: "bench", index } });
  const bySha = new Map(sources.map((text) => [sha256(text), text]));
  for (const entry of plan.uploadSources) {
    await call("PUT", "/publish/source", {
      body: Buffer.from(bySha.get(entry.sha256), "utf8"),
      query: new URLSearchParams({ target: "bench", sha256: entry.sha256 })
    });
  }
  return { uploads: plan.uploadSources.length, ...(await commit(index)) };
}

async function commit(index) {
  const started = Date.now();
  const summary = await call("POST", "/publish/commit", { body: { target: "bench", index } });
  return { commitMs: Date.now() - started, summary };
}

async function measure(label, work) {
  sftp.resetStats();
  const started = Date.now();
  const result = await work();
  const reads = sftp.stats.reads.filter((path) => path.includes("/src/")).length;
  console.log(
    `${label.padEnd(26)} ${String(Date.now() - started).padStart(7)} ms total` +
      `  ${String(result.commitMs).padStart(7)} ms commit` +
      `  ${String(sftp.requestCount).padStart(6)} requests` +
      `  ${String(reads).padStart(4)} sources read` +
      `  ${String(result.uploads ?? 0).padStart(4)} uploads` +
      `  written ${result.summary.written}, unchanged ${result.summary.unchanged}`
  );
}

console.log(`${NOTES} notes, ${LATENCY_MS} ms per SFTP request\n`);
const sources = Array.from({ length: NOTES }, (_, i) => source(i));

try {
  await measure("first publish", () => publish(sources));

  const edited = [...sources];
  edited[7] = source(7, 2);
  await measure("one note edited", () => publish(edited));

  await measure("nothing changed", () => publish(edited));

  // A redeploy starts with nothing in memory.
  routes = createPublishRoutes(config, { version: "bench" });
  await measure("nothing changed, restarted", () => commit(indexFor(edited)));
} finally {
  await sftp.stop();
}
