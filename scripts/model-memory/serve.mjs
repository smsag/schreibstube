// Serve the measuring page and write what it reports to out/steps.log.
import { createServer } from "node:http";
import { appendFileSync, readFileSync } from "node:fs";
import { dirname, extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const types = { ".html": "text/html", ".mjs": "text/javascript", ".json": "application/json" };
createServer((req, res) => {
  if (req.method === "POST") {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      appendFileSync(join(here, "out", "steps.log"), body + "\n");
      res.writeHead(204).end();
    });
    return;
  }
  const path = normalize(new URL(req.url ?? "/", "http://x").pathname).replace(/^(\.\.[/\\])+/, "");
  const file = join(
    here,
    path === "/" ? "index.html" : path.startsWith("/out/") ? path : `/out${path}`
  );
  try {
    const data =
      path === "/" || path === "/index.html"
        ? readFileSync(join(here, "index.html"))
        : readFileSync(file);
    res
      .writeHead(200, { "content-type": types[extname(file)] ?? "application/octet-stream" })
      .end(data);
  } catch {
    res.writeHead(404).end();
  }
}).listen(8765, "127.0.0.1");
