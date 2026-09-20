/**
 * A CalDAV server, in process, for tests.
 *
 * Talking to a calendar is a story about someone else's HTTP: a PROPFIND that
 * answers 207 with namespaces of its own choosing, a PUT that refuses because
 * `If-None-Match` said so, a resource whose file name has nothing to do with
 * its UID. None of that is provable against a mock of our own client, so the
 * tests drive real requests into a real server and then look at what it holds
 * — the same bargain `publish/sftp-fixture.mjs` makes for SFTP.
 *
 * Only what the bridge actually sends is implemented, and only well enough to
 * be a fair opponent: it checks Basic auth, it returns hrefs that are not
 * derivable from UIDs, and it can be told to misbehave on purpose.
 */
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";

const DAV = "DAV:";
const CALDAV = "urn:ietf:params:xml:ns:caldav";

/**
 * Start one.
 *
 * `calendars` names the collections it offers. A few addresses are special so
 * that a failure can be reached without a network of its own: the calendar
 * `verboten` answers 403 and `riesig` answers with more bytes than any sane
 * limit, while `/umzug/` redirects to the real collection, `/fremd/` redirects
 * off the host entirely, `/schleife/` redirects to itself and `/anders/`
 * answers a 303.
 */
export async function startCalDavServer({
  user = "planer",
  password = "geheim",
  calendars = ["arbeit", "privat"]
} = {}) {
  /** calendar name -> (resource file name -> ICS text) */
  const store = new Map(calendars.map((name) => [name, new Map()]));
  const seen = [];

  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://caldav.test");
    seen.push({ method: req.method, path: url.pathname });

    const expected = `Basic ${Buffer.from(`${user}:${password}`, "utf8").toString("base64")}`;
    if (req.headers.authorization !== expected) {
      res.writeHead(401, { "www-authenticate": 'Basic realm="calendar"' });
      res.end();
      return;
    }

    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      const body = Buffer.concat(chunks).toString("utf8");
      try {
        handle({ req, res, url, body, store });
      } catch (err) {
        res.writeHead(500, { "content-type": "text/plain" });
        res.end(String(err.message));
      }
    });
  });

  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  const { port } = server.address();

  return {
    port,
    user,
    password,
    url: `http://127.0.0.1:${port}/dav/`,
    /** Addresses that redirect, so each hop can be exercised on purpose. */
    redirectUrl: `http://127.0.0.1:${port}/umzug/`,
    offHostUrl: `http://127.0.0.1:${port}/fremd/`,
    loopUrl: `http://127.0.0.1:${port}/schleife/`,
    otherMethodUrl: `http://127.0.0.1:${port}/anders/`,
    requests: seen,

    /** Put an event there the way another client would have: a resource name
     *  that has nothing to do with the UID inside it. */
    seed(calendar, ics, { resource = `${randomUUID()}.ics` } = {}) {
      store.get(calendar).set(resource, ics);
      return resource;
    },
    resources(calendar) {
      return [...store.get(calendar).keys()];
    },
    clear() {
      for (const events of store.values()) events.clear();
    },
    contents(calendar) {
      return [...store.get(calendar).values()];
    },
    async stop() {
      await new Promise((done) => server.close(done));
    }
  };
}

function handle({ req, res, url, body, store }) {
  const method = req.method ?? "GET";
  const segments = url.pathname.split("/").filter(Boolean);

  if (segments[0] === "umzug") {
    const target = `/dav/${segments.slice(1).join("/")}${url.pathname.endsWith("/") ? "/" : ""}`;
    res.writeHead(308, { location: target });
    res.end();
    return;
  }
  if (segments[0] === "fremd") {
    res.writeHead(308, { location: "http://anderswo.invalid/dav/" });
    res.end();
    return;
  }
  if (segments[0] === "schleife") {
    res.writeHead(308, { location: url.pathname });
    res.end();
    return;
  }
  if (segments[0] === "anders") {
    res.writeHead(303, { location: "/dav/" });
    res.end();
    return;
  }
  if (segments[0] !== "dav") {
    res.writeHead(404);
    res.end();
    return;
  }

  const [, calendar, resource] = segments;

  if (method === "PROPFIND" && !calendar) {
    return multistatus(res, [
      response("/dav/", { collection: true }),
      ...[...store.keys()].map((name) =>
        response(`/dav/${name}/`, { collection: true, calendar: true, displayName: `Die ${name}` })
      )
    ]);
  }

  if (calendar === "verboten") {
    res.writeHead(403);
    res.end();
    return;
  }
  if (calendar === "riesig" && method === "REPORT") {
    res.writeHead(207, { "content-type": "application/xml" });
    res.end("x".repeat(400_000));
    return;
  }

  const events = store.get(calendar);
  if (!events) {
    res.writeHead(404);
    res.end();
    return;
  }

  if (method === "REPORT") return report(res, calendar, events, body);

  if (method === "PUT") {
    if (!resource) {
      res.writeHead(405);
      res.end();
      return;
    }
    const exists = events.has(resource);
    if (exists && req.headers["if-none-match"] === "*") {
      res.writeHead(412);
      res.end();
      return;
    }
    events.set(resource, body);
    res.writeHead(exists ? 204 : 201, { etag: `"${events.size}-${resource}"` });
    res.end();
    return;
  }

  if (method === "DELETE") {
    if (!events.delete(resource)) {
      res.writeHead(404);
      res.end();
      return;
    }
    res.writeHead(204);
    res.end();
    return;
  }

  res.writeHead(405);
  res.end();
}

/**
 * Answer a calendar-query.
 *
 * Two filters are understood, because two are what the bridge sends: a
 * time-range, matched against each stored DTSTART, and a UID prop-filter.
 * DTSTART is read with a regex of the fixture's own rather than through
 * `ical.mjs`, so the test is not grading the parser against itself.
 */
function report(res, calendar, events, body) {
  const uid = /<[^>]*text-match[^>]*>([^<]*)<\//i.exec(body)?.[1];
  const range = /<[^>]*time-range[^>]*start="([^"]+)"[^>]*end="([^"]+)"/i.exec(body);

  const matched = [];
  for (const [resource, ics] of events) {
    if (uid !== undefined && uidOf(ics) !== uid) continue;
    if (range && !within(ics, range[1], range[2])) continue;
    matched.push(response(`/dav/${calendar}/${resource}`, { etag: `"${resource}"`, ics }));
  }
  return multistatus(res, matched);
}

function uidOf(ics) {
  return /^UID:(.*)$/m.exec(ics)?.[1].trim();
}

function within(ics, start, end) {
  const at = /^DTSTART[^:]*:(.*)$/m.exec(ics)?.[1].trim();
  if (!at) return false;
  // Both forms sort correctly as text once the date-only one is padded, which
  // is all a fixture needs.
  const stamp = at.length === 8 ? `${at}T000000Z` : at;
  return stamp >= start && stamp < end;
}

function response(href, { collection, calendar, displayName, etag, ics } = {}) {
  const resourcetype = collection
    ? `<d:resourcetype><d:collection/>${calendar ? "<c:calendar/>" : ""}</d:resourcetype>`
    : "<d:resourcetype/>";

  return `  <d:response>
    <d:href>${href}</d:href>
    <d:propstat>
      <d:prop>
        ${displayName ? `<d:displayname>${escape(displayName)}</d:displayname>` : ""}
        ${resourcetype}
        ${etag ? `<d:getetag>${escape(etag)}</d:getetag>` : ""}
        ${ics ? `<c:calendar-data>${escape(ics)}</c:calendar-data>` : ""}
      </d:prop>
      <d:status>HTTP/1.1 200 OK</d:status>
    </d:propstat>
  </d:response>`;
}

function multistatus(res, responses) {
  const xml = `<?xml version="1.0" encoding="utf-8"?>
<d:multistatus xmlns:d="${DAV}" xmlns:c="${CALDAV}">
${responses.join("\n")}
</d:multistatus>`;

  res.writeHead(207, { "content-type": "application/xml; charset=utf-8" });
  res.end(xml);
}

function escape(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
