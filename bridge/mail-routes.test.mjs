import { describe, expect, it } from "vitest";
import { createMailRoutes } from "./mail-routes.mjs";
import { TimeoutError } from "./timeout.mjs";

/**
 * The send route's answers, with the SMTP leg replaced: what matters here is
 * which failure the plugin is told about, since that decides whether a person
 * sends the mail again.
 */
function sendRoute(sendMail) {
  const config = {
    upstreamTimeoutMs: 1000,
    requestTimeoutMs: 1000,
    mail: {
      from: "Schreibstube <post@example.com>",
      sentMailbox: "",
      maxTextChars: 40_000,
      maxBodyBytes: 1_000_000
    }
  };
  const routes = createMailRoutes(config, { transport: { sendMail } });
  const route = routes.find((candidate) => candidate.path === "/send");
  return (body) => route.handler({ body, log: () => {} });
}

const valid = { to: ["kunde@example.com"], subject: "Angebot", text: "Guten Tag" };

describe("POST /send", () => {
  it("answers a send the server never confirmed as unconfirmed, not failed", async () => {
    const send = sendRoute(async () => {
      throw new TimeoutError("Send", 1000);
    });
    await expect(send(valid)).rejects.toMatchObject({ status: 504, code: "send_unconfirmed" });
  });

  it("answers a refusal the server gave as a failure", async () => {
    const send = sendRoute(async () => {
      throw Object.assign(new Error("535 authentication failed"), {
        command: "AUTH PLAIN",
        responseCode: 535
      });
    });
    await expect(send(valid)).rejects.toMatchObject({ status: 502, code: "upstream_error" });
  });

  it("returns the refused recipients of a send that went out", async () => {
    const send = sendRoute(async () => ({ accepted: ["kunde@example.com"], rejected: ["x@y.de"] }));
    await expect(send(valid)).resolves.toMatchObject({ rejected: ["x@y.de"] });
  });
});
