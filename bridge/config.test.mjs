import { describe, expect, it } from "vitest";
import {
  MIN_TOKEN_DISTINCT_CHARS,
  MIN_TOKEN_LENGTH,
  PROTOCOL_VERSION,
  capabilityNames,
  isWithin,
  loadConfig
} from "./config.mjs";

/**
 * These began as characterisation tests for the single-capability
 * configuration and were carried over to the capability shape. What each rule
 * accepts and rejects is unchanged; where a value lives, and the name of the
 * token, are not.
 */

// Exactly the minimum length, and as varied as a generated token.
const TOKEN = "Abcdefghijklmnopqrstuvwxyz0123456789".slice(0, MIN_TOKEN_LENGTH);

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

  it("refuses a MAIL_FROM without an address, which sent mail with no From", () => {
    expect(() => loadConfig(env({ MAIL_FROM: "Steffen Seitz" }))).toThrow(/^MAIL_FROM must hold/);
  });

  it("accepts a MAIL_FROM that is a bare address", () => {
    expect(loadConfig(env({ MAIL_FROM: " post@example.com " })).mail.from).toBe("post@example.com");
  });

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

  it("refuses the placeholder from .env.example, however it is spelled", () => {
    for (const placeholder of [
      "replace-me-with-at-least-24-characters",
      "REPLACE-ME-with-at-least-24-characters",
      "my-own-Replaceme-token-0123456789"
    ]) {
      expect(() => loadConfig(env({ MAIL_TOKEN: placeholder }))).toThrow(
        /^MAIL_TOKEN is still the placeholder/
      );
    }
  });

  it("refuses a long token made of too few characters, which no generator writes", () => {
    expect(() => loadConfig(env({ MAIL_TOKEN: "x".repeat(40) }))).toThrow(
      new RegExp(`^MAIL_TOKEN must use at least ${MIN_TOKEN_DISTINCT_CHARS} different`)
    );
    expect(() => loadConfig(env({ MAIL_TOKEN: "abcabcabcabcabcabcabcabcabc" }))).toThrow(
      /different characters/
    );
  });

  it("accepts a generated token", () => {
    const generated = "q3Vh0mJ8Zr+1kYwF/8sLx2pN6tE4aC9uB7dG5iO0hRk=";
    expect(loadConfig(env({ MAIL_TOKEN: generated })).mail.token).toBe(generated);
  });

  it("refuses one token for both capabilities, which made the publish token a mail one", () => {
    const both = env({
      PUBLISH_TOKEN: TOKEN,
      PUBLISH_TARGETS: "blog",
      PUBLISH_BLOG_HOST: "sftp.example.com",
      PUBLISH_BLOG_USER: "web",
      PUBLISH_BLOG_PASSWORD: "geheim",
      PUBLISH_BLOG_HOST_FINGERPRINT: "SHA256:abc",
      PUBLISH_BLOG_ROOT: "/var/www/blog",
      PUBLISH_BLOG_BASE_URL: "https://blog.example.com"
    });
    expect(() => loadConfig(both)).toThrow(/MAIL_TOKEN and PUBLISH_TOKEN are the same/);
    const reversed = `${TOKEN.slice(1)}Z`;
    expect(capabilityNames(loadConfig({ ...both, PUBLISH_TOKEN: reversed }))).toEqual([
      "mail",
      "publish"
    ]);
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
    // Unset means "ask the server", not a fixed name.
    expect(mail.sentMailbox).toBeNull();
  });

  it("treats an empty SENT_MAILBOX as 'do not file a copy'", () => {
    expect(loadConfig(env({ SENT_MAILBOX: "" })).mail.sentMailbox).toBe("");
  });

  it("treats a blank SENT_MAILBOX as unset, not as opting out", () => {
    expect(loadConfig(env({ SENT_MAILBOX: "   " })).mail.sentMailbox).toBeNull();
  });

  it("keeps a name with a space, as Strato's Sent folder has", () => {
    expect(loadConfig(env({ SENT_MAILBOX: " Sent Items " })).mail.sentMailbox).toBe("Sent Items");
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

  it("counts TRUST_PROXY as one proxy, and none without it", () => {
    expect(loadConfig(env({ TRUST_PROXY: "true" })).trustProxyHops).toBe(1);
    expect(loadConfig(env()).trustProxyHops).toBe(0);
  });

  it("takes the number of proxies from TRUST_PROXY_HOPS, which trusts them by itself", () => {
    const config = loadConfig(env({ TRUST_PROXY_HOPS: "2" }));
    expect(config.trustProxyHops).toBe(2);
    expect(config.trustProxy).toBe(true);
    expect(loadConfig(env({ TRUST_PROXY: "true", TRUST_PROXY_HOPS: "3" })).trustProxyHops).toBe(3);
  });

  it("refuses a number of proxies that contradicts TRUST_PROXY or is no number of proxies", () => {
    expect(() => loadConfig(env({ TRUST_PROXY: "false", TRUST_PROXY_HOPS: "2" }))).toThrow(
      /TRUST_PROXY_HOPS is set but TRUST_PROXY is false/
    );
    expect(() => loadConfig(env({ TRUST_PROXY_HOPS: "11" }))).toThrow(/up to 10/);
    expect(() => loadConfig(env({ TRUST_PROXY_HOPS: "0" }))).toThrow(/TRUST_PROXY_HOPS/);
  });
});

describe("loadConfig, what a send may do", () => {
  it("allows only MAIL_FROM's address as a From by default", () => {
    const { mail } = loadConfig(env());
    expect([...mail.fromAllowed.addresses]).toEqual(["post@example.com"]);
    expect(mail.fromAllowed.domains.size).toBe(0);
  });

  it("reads MAIL_FROM_ALLOWED beside MAIL_FROM, and refuses an entry it cannot read", () => {
    const { mail } = loadConfig(env({ MAIL_FROM_ALLOWED: "buero@example.org, @example.de" }));
    expect([...mail.fromAllowed.addresses]).toEqual(["post@example.com", "buero@example.org"]);
    expect([...mail.fromAllowed.domains]).toEqual(["example.de"]);
    expect(() => loadConfig(env({ MAIL_FROM_ALLOWED: "*" }))).toThrow(/MAIL_FROM_ALLOWED/);
  });

  it("defaults the recipients per mail and the mails per hour", () => {
    const { mail } = loadConfig(env());
    expect(mail.maxRecipients).toBe(50);
    expect(mail.sendPerHour).toBe(60);
    const set = loadConfig(env({ MAX_RECIPIENTS: "5", MAIL_SEND_PER_HOUR: "10" })).mail;
    expect(set).toMatchObject({ maxRecipients: 5, sendPerHour: 10 });
    expect(() => loadConfig(env({ MAIL_SEND_PER_HOUR: "0" }))).toThrow(/MAIL_SEND_PER_HOUR/);
  });
});

describe("loadConfig, connections", () => {
  it("bounds the sockets open at once, by default and by MAX_CONNECTIONS", () => {
    expect(loadConfig(env()).maxConnections).toBe(100);
    expect(loadConfig(env({ MAX_CONNECTIONS: "20" })).maxConnections).toBe(20);
    expect(() => loadConfig(env({ MAX_CONNECTIONS: "viele" }))).toThrow(/MAX_CONNECTIONS/);
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

describe("loadConfig, the publish state directory", () => {
  const publishEnv = (overrides = {}) => ({
    PUBLISH_TOKEN: TOKEN,
    PUBLISH_TARGETS: "blog",
    PUBLISH_BLOG_HOST: "sftp.example.com",
    PUBLISH_BLOG_USER: "web",
    PUBLISH_BLOG_PASSWORD: "geheim",
    PUBLISH_BLOG_HOST_FINGERPRINT: "SHA256:abc",
    PUBLISH_BLOG_ROOT: "/var/www/blog/",
    PUBLISH_BLOG_BASE_URL: "https://blog.example.com",
    ...overrides
  });

  it("defaults to a directory inside the web root, and says so", () => {
    const { blog } = loadConfig(publishEnv()).publish.targets;
    expect(blog.stateRoot).toBe("/var/www/blog/.schreibstube");
    expect(blog.stateInsideRoot).toBe(true);
  });

  it("knows a directory outside the web root is outside", () => {
    const { blog } = loadConfig(publishEnv({ PUBLISH_BLOG_STATE_ROOT: "/var/schreibstube/blog/" }))
      .publish.targets;
    expect(blog.stateRoot).toBe("/var/schreibstube/blog");
    expect(blog.stateInsideRoot).toBe(false);
  });

  it("refuses a relative state directory, as it refuses a relative root", () => {
    expect(() => loadConfig(publishEnv({ PUBLISH_BLOG_STATE_ROOT: "state" }))).toThrow(
      /STATE_ROOT must be an absolute path/
    );
  });
});

describe("isWithin", () => {
  it("compares by segment, not by prefix", () => {
    expect(isWithin("/var/www/blog-state", "/var/www/blog")).toBe(false);
    expect(isWithin("/var/www/blog/state", "/var/www/blog")).toBe(true);
    expect(isWithin("/var/www/blog", "/var/www/blog/")).toBe(true);
  });

  it("counts a path that climbs as inside, because that is the answer that warns", () => {
    expect(isWithin("/var/www/blog/../state", "/srv")).toBe(true);
  });

  it("puts everything inside a root of /", () => {
    expect(isWithin("/anything", "/")).toBe(true);
  });
});

describe("loadConfig, the publish target's own values", () => {
  const publishEnv = (overrides = {}) => ({
    PUBLISH_TOKEN: TOKEN,
    PUBLISH_TARGETS: "blog",
    PUBLISH_BLOG_HOST: "sftp.example.com",
    PUBLISH_BLOG_USER: "web",
    PUBLISH_BLOG_PASSWORD: "geheim",
    PUBLISH_BLOG_HOST_FINGERPRINT: "SHA256:abc",
    PUBLISH_BLOG_ROOT: "/var/www/blog/",
    PUBLISH_BLOG_BASE_URL: "https://blog.example.com",
    ...overrides
  });
  const pem =
    "-----BEGIN OPENSSH PRIVATE KEY-----\nb3BlbnNzaC1rZXktdjEA\n-----END OPENSSH PRIVATE KEY-----\n";
  const keyed = (key) =>
    publishEnv({
      PUBLISH_BLOG_PASSWORD: "",
      PUBLISH_BLOG_KEY: Buffer.from(key).toString("base64")
    });

  it("accepts a key that reads as a private key, PEM or OpenSSH", () => {
    expect(loadConfig(keyed(pem)).publish.targets.blog.key).toBe(pem.trim());
    const rsa = "-----BEGIN RSA PRIVATE KEY-----\nMIIE\n-----END RSA PRIVATE KEY-----";
    expect(loadConfig(keyed(rsa)).publish.targets.blog.key).toBe(rsa);
  });

  it("refuses a key that is not one at boot, not on the first publish", () => {
    expect(() => loadConfig(keyed("ssh-ed25519 AAAAC3 web@host"))).toThrow(/PUBLISH_BLOG_KEY/);
    expect(() =>
      loadConfig(publishEnv({ PUBLISH_BLOG_PASSWORD: "", PUBLISH_BLOG_KEY: pem }))
    ).toThrow(/base64 of a PEM, OpenSSH or PuTTY private key/);
  });

  it("names the target's variable when its port or flag is unreadable", () => {
    expect(() => loadConfig(publishEnv({ PUBLISH_BLOG_PORT: "zwei" }))).toThrow(
      /PUBLISH_BLOG_PORT must be a positive integer/
    );
    expect(() => loadConfig(publishEnv({ PUBLISH_BLOG_ALLOW_HTML: "jein" }))).toThrow(
      /PUBLISH_BLOG_ALLOW_HTML must be true or false/
    );
    expect(() => loadConfig(publishEnv({ PUBLISH_BLOG_ALLOW_DIAGRAMS: "jein" }))).toThrow(
      /PUBLISH_BLOG_ALLOW_DIAGRAMS/
    );
  });
});

describe("loadConfig, numbers", () => {
  it("reads decimal digits only", () => {
    for (const value of ["1e3", "0x10", "1_000", "+5", "5.0", " 5 5"]) {
      expect(() => loadConfig(env({ MAX_RESULTS: value }))).toThrow(/MAX_RESULTS/);
    }
    expect(loadConfig(env({ MAX_RESULTS: " 12 " })).mail.maxResults).toBe(12);
  });

  it("bounds every port to what a port can be", () => {
    for (const key of ["PORT", "IMAP_PORT", "SMTP_PORT"]) {
      expect(() => loadConfig(env({ [key]: "65536" }))).toThrow(new RegExp(`${key} .*up to 65535`));
      expect(() => loadConfig(env({ [key]: "0" }))).toThrow(new RegExp(key));
    }
    expect(loadConfig(env({ PORT: "65535" })).port).toBe(65535);
  });
});
