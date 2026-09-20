import { describe, expect, it } from "vitest";
import { MIN_TOKEN_LENGTH, PROTOCOL_VERSION, capabilityNames, loadConfig } from "./config.mjs";

/**
 * These began as characterisation tests for the single-capability
 * configuration and were carried over to the capability shape. What each rule
 * accepts and rejects is unchanged; where a value lives, and the name of the
 * token, are not.
 */

const TOKEN = "x".repeat(MIN_TOKEN_LENGTH);

function env(overrides = {}) {
  return {
    MAIL_TOKEN: TOKEN,
    IMAP_HOST: "imap.example.com",
    SMTP_HOST: "smtp.example.com",
    MAIL_USER: "post@example.com",
    MAIL_PASSWORD: "geheim",
    MAIL_FROM: "Schreibstube <post@example.com>",
    ...overrides
  };
}

describe("loadConfig, capabilities", () => {
  it("offers mail when its variables are present", () => {
    const config = loadConfig(env());
    expect(config.mail.token).toBe(TOKEN);
    expect(capabilityNames(config)).toEqual(["mail"]);
  });

  it("refuses to start when no capability is configured at all", () => {
    expect(() => loadConfig({})).toThrow(/No capability is configured/);
  });

  it("names the mail variables when nothing is configured", () => {
    expect(() => loadConfig({})).toThrow(/MAIL_TOKEN/);
  });

  it("treats a partial mail configuration as an error, not as absent", () => {
    expect(() => loadConfig({ IMAP_HOST: "imap.example.com" })).toThrow(
      /Missing required environment variables/
    );
  });

  it("reports a protocol version for the plugin to compare against", () => {
    expect(PROTOCOL_VERSION).toBeGreaterThan(0);
  });
});

describe("loadConfig, required values", () => {
  for (const key of [
    "MAIL_TOKEN",
    "IMAP_HOST",
    "SMTP_HOST",
    "MAIL_USER",
    "MAIL_PASSWORD",
    "MAIL_FROM"
  ]) {
    it(`names ${key} when it is missing`, () => {
      const incomplete = env();
      delete incomplete[key];
      expect(() => loadConfig(incomplete)).toThrow(key);
    });

    it(`treats a blank ${key} as missing`, () => {
      expect(() => loadConfig(env({ [key]: "   " }))).toThrow(key);
    });
  }

  it("rejects a token below the minimum length, naming the length it got", () => {
    expect(() => loadConfig(env({ MAIL_TOKEN: "kurz" }))).toThrow(/got 4/);
  });

  it("names the token it is complaining about", () => {
    expect(() => loadConfig(env({ MAIL_TOKEN: "kurz" }))).toThrow(/^MAIL_TOKEN/);
  });

  it("accepts a token of exactly the minimum length", () => {
    expect(loadConfig(env()).mail.token.length).toBe(MIN_TOKEN_LENGTH);
  });

  it("trims the token", () => {
    expect(loadConfig(env({ MAIL_TOKEN: ` ${TOKEN} ` })).mail.token).toBe(TOKEN);
  });
});

describe("loadConfig, defaults", () => {
  it("defaults the port and the request budgets", () => {
    const config = loadConfig(env());
    expect(config.port).toBe(8080);
    expect(config.requestTimeoutMs).toBe(30_000);
    expect(config.upstreamTimeoutMs).toBe(20_000);
    expect(config.drainTimeoutMs).toBe(10_000);
  });

  it("defaults the throttle", () => {
    const config = loadConfig(env());
    expect(config.authFailureLimit).toBe(5);
    expect(config.authFailureWindowMs).toBe(60_000);
  });

  it("defaults the mail limits", () => {
    const { mail } = loadConfig(env());
    expect(mail.maxBodyBytes).toBe(1_000_000);
    expect(mail.maxTextChars).toBe(40_000);
    expect(mail.maxResults).toBe(50);
  });

  it("defaults both protocols to their implicit-TLS ports", () => {
    const { mail } = loadConfig(env());
    expect(mail.imap).toMatchObject({ port: 993, secure: true });
    expect(mail.smtp).toMatchObject({ port: 465, secure: true });
  });

  it("defaults to the STARTTLS ports when TLS is switched off", () => {
    const { mail } = loadConfig(env({ IMAP_SECURE: "false", SMTP_SECURE: "0" }));
    expect(mail.imap).toMatchObject({ port: 143, secure: false });
    expect(mail.smtp).toMatchObject({ port: 587, secure: false });
  });

  it("keeps an explicit port when TLS is switched off", () => {
    const { mail } = loadConfig(env({ IMAP_SECURE: "no", IMAP_PORT: "1143" }));
    expect(mail.imap.port).toBe(1143);
  });

  it("defaults the mailboxes", () => {
    const { mail } = loadConfig(env());
    expect(mail.defaultMailbox).toBe("INBOX");
    expect(mail.sentMailbox).toBe("Sent");
  });

  it("treats an empty SENT_MAILBOX as 'do not file a copy'", () => {
    expect(loadConfig(env({ SENT_MAILBOX: "" })).mail.sentMailbox).toBe("");
  });

  it("treats a blank SENT_MAILBOX as the default, not as opting out", () => {
    expect(loadConfig(env({ SENT_MAILBOX: "   " })).mail.sentMailbox).toBe("Sent");
  });
});

describe("loadConfig, proxy", () => {
  it("does not trust X-Forwarded-For unless told to", () => {
    expect(loadConfig(env()).trustProxy).toBe(false);
  });

  it("trusts the proxy when TRUST_PROXY is set", () => {
    expect(loadConfig(env({ TRUST_PROXY: "true" })).trustProxy).toBe(true);
    expect(loadConfig(env({ TRUST_PROXY: "false" })).trustProxy).toBe(false);
  });
});

describe("loadConfig, parsing", () => {
  it("falls back only when the variable is unset", () => {
    expect(loadConfig(env({ PORT: "" })).port).toBe(8080);
    expect(loadConfig(env({ PORT: "9090" })).port).toBe(9090);
  });

  it("refuses to boot on a number that is set and unreadable", () => {
    // Silently substituting the default is what let PORT=808O and
    // AUTH_FAILURE_LIMIT=0 through, in a module whose promise is that a
    // misconfigured deployment does not start.
    for (const value of ["abc", "0", "-5", "808O", "1.5"]) {
      expect(() => loadConfig(env({ PORT: value }))).toThrow(/PORT/);
    }
  });

  it("reads the false-ish spellings of a boolean", () => {
    for (const value of ["0", "false", "no", "off", "FALSE", " Off "]) {
      expect(loadConfig(env({ IMAP_SECURE: value })).mail.imap.secure).toBe(false);
    }
  });

  it("reads the true-ish spellings of a boolean", () => {
    for (const value of ["1", "true", "yes", "on", "TRUE", " On "]) {
      expect(loadConfig(env({ IMAP_SECURE: value })).mail.imap.secure).toBe(true);
    }
  });

  it("refuses a boolean spelled as neither", () => {
    // "flase" used to read as true — the reading furthest from what was typed.
    expect(() => loadConfig(env({ IMAP_SECURE: "flase" }))).toThrow(/IMAP_SECURE/);
  });

  it("trims hosts and the user but never the password", () => {
    const { mail } = loadConfig(
      env({ IMAP_HOST: " imap.example.com ", MAIL_PASSWORD: " geheim " })
    );
    expect(mail.imap.host).toBe("imap.example.com");
    expect(mail.imap.auth.pass).toBe(" geheim ");
  });

  it("uses the same credentials for both protocols", () => {
    const { mail } = loadConfig(env());
    expect(mail.imap.auth).toEqual(mail.smtp.auth);
  });
});

/**
 * Planning is the third capability, and the first that keeps anything. Its
 * variables follow the same rule as the other two — present any of them and
 * the operator meant it — with the store path and the calendar allowlist as
 * the two that have an answer when they are left out.
 */
const PLAN = {
  PLAN_TOKEN: TOKEN,
  CALDAV_URL: "https://caldav.icloud.com/1234/calendars",
  CALDAV_USER: "planer@example.com",
  CALDAV_PASSWORD: "geheim"
};

describe("loadConfig, plan", () => {
  it("offers planning when its variables are present", () => {
    const config = loadConfig(PLAN);
    expect(config.plan.token).toBe(TOKEN);
    expect(capabilityNames(config)).toEqual(["plan"]);
  });

  it("does not offer planning when none of its variables is set", () => {
    expect(loadConfig(env()).plan).toBeNull();
  });

  it("offers all three capabilities side by side", () => {
    const config = loadConfig({
      ...env(),
      ...PLAN,
      PUBLISH_TOKEN: TOKEN,
      PUBLISH_TARGETS: "blog",
      PUBLISH_BLOG_HOST: "sftp.example.com",
      PUBLISH_BLOG_USER: "web",
      PUBLISH_BLOG_PASSWORD: "geheim",
      PUBLISH_BLOG_HOST_FINGERPRINT: "SHA256:abc",
      PUBLISH_BLOG_ROOT: "/var/www",
      PUBLISH_BLOG_BASE_URL: "https://blog.example.com"
    });
    expect(capabilityNames(config)).toEqual(["mail", "publish", "plan"]);
  });

  it("names the plan variables when nothing at all is configured", () => {
    expect(() => loadConfig({})).toThrow(/PLAN_TOKEN/);
  });

  for (const key of Object.keys(PLAN)) {
    it(`treats a partial plan configuration as an error, naming ${key}`, () => {
      const incomplete = { ...PLAN };
      delete incomplete[key];
      expect(() => loadConfig(incomplete)).toThrow(key);
    });
  }

  it("treats the store path alone as an intention to offer planning", () => {
    // Otherwise a half-written block would be silently ignored rather than
    // reported, which is the failure this rule exists to prevent.
    expect(() => loadConfig({ PLAN_STORE: "./data/plan.json" })).toThrow(/PLAN_TOKEN/);
  });

  it("holds the token to the same minimum length as the others", () => {
    expect(() => loadConfig({ ...PLAN, PLAN_TOKEN: "kurz" })).toThrow(/^PLAN_TOKEN/);
  });

  it("defaults the store path, and takes one when it is given", () => {
    expect(loadConfig(PLAN).plan.store).toBe("./data/plan.json");
    expect(loadConfig({ ...PLAN, PLAN_STORE: " /daten/plan.json " }).plan.store).toBe(
      "/daten/plan.json"
    );
  });

  it("defaults the two budgets", () => {
    const { plan } = loadConfig(PLAN);
    expect(plan.maxBodyBytes).toBe(600_000);
    expect(plan.maxResponseBytes).toBe(8_000_000);
  });

  it("refuses a budget that is set and unreadable", () => {
    expect(() => loadConfig({ ...PLAN, PLAN_MAX_BODY_BYTES: "viel" })).toThrow(
      /PLAN_MAX_BODY_BYTES/
    );
  });

  it("insists the calendar URL is https, or loopback for a local server", () => {
    expect(() => loadConfig({ ...PLAN, CALDAV_URL: "http://caldav.example.com/" })).toThrow(
      /CALDAV_URL must be https/
    );
    expect(loadConfig({ ...PLAN, CALDAV_URL: "http://127.0.0.1:8081/dav/" }).plan.caldav.url).toBe(
      "http://127.0.0.1:8081/dav/"
    );
  });

  it("refuses a calendar URL that is not a URL", () => {
    expect(() => loadConfig({ ...PLAN, CALDAV_URL: "https://" })).toThrow(
      /CALDAV_URL is not a URL/
    );
  });

  it("gives the calendar URL a trailing slash, so a name resolves under it", () => {
    expect(loadConfig(PLAN).plan.caldav.url).toBe("https://caldav.icloud.com/1234/calendars/");
  });

  it("reads an empty allowlist as every calendar the server offers", () => {
    expect(loadConfig(PLAN).plan.caldav.calendars).toEqual([]);
    expect(loadConfig({ ...PLAN, CALDAV_CALENDARS: " , " }).plan.caldav.calendars).toEqual([]);
  });

  it("reads the allowlist as a comma-separated list, trimmed", () => {
    expect(
      loadConfig({ ...PLAN, CALDAV_CALENDARS: " arbeit , privat " }).plan.caldav.calendars
    ).toEqual(["arbeit", "privat"]);
  });

  it("refuses a calendar name it could not address safely", () => {
    for (const name of ["..", "mit leerzeichen", "/absolut", "-führend"]) {
      expect(() => loadConfig({ ...PLAN, CALDAV_CALENDARS: name })).toThrow(
        /Unusable calendar name/
      );
    }
  });

  it("trims the user but never the password", () => {
    const { plan } = loadConfig({ ...PLAN, CALDAV_USER: " planer ", CALDAV_PASSWORD: " geheim " });
    expect(plan.caldav.user).toBe("planer");
    expect(plan.caldav.password).toBe(" geheim ");
  });

  it("reports a protocol version the plan routes belong to", () => {
    expect(PROTOCOL_VERSION).toBe(2);
  });
});
