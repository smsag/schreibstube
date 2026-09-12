import { describe, expect, it } from "vitest";
import { MIN_TOKEN_LENGTH, loadConfig } from "./config.mjs";

/**
 * Characterisation tests: they describe what the bridge does today, before the
 * restructure into capabilities, so the diff that changes behaviour has to
 * change a test and say so.
 */

const TOKEN = "x".repeat(MIN_TOKEN_LENGTH);

function env(overrides = {}) {
  return {
    BRIDGE_TOKEN: TOKEN,
    IMAP_HOST: "imap.example.com",
    SMTP_HOST: "smtp.example.com",
    MAIL_USER: "post@example.com",
    MAIL_PASSWORD: "geheim",
    MAIL_FROM: "Schreibstube <post@example.com>",
    ...overrides
  };
}

describe("loadConfig, required values", () => {
  it("accepts a complete environment", () => {
    expect(loadConfig(env()).token).toBe(TOKEN);
  });

  for (const key of [
    "BRIDGE_TOKEN",
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
    expect(() => loadConfig(env({ BRIDGE_TOKEN: "kurz" }))).toThrow(/got 4/);
  });

  it("accepts a token of exactly the minimum length", () => {
    expect(loadConfig(env({ BRIDGE_TOKEN: TOKEN })).token.length).toBe(MIN_TOKEN_LENGTH);
  });

  it("trims the token", () => {
    expect(loadConfig(env({ BRIDGE_TOKEN: ` ${TOKEN} ` })).token).toBe(TOKEN);
  });
});

describe("loadConfig, defaults", () => {
  it("defaults the port, body and text limits", () => {
    const config = loadConfig(env());
    expect(config.port).toBe(8080);
    expect(config.maxBodyBytes).toBe(1_000_000);
    expect(config.maxTextChars).toBe(40_000);
    expect(config.maxResults).toBe(50);
  });

  it("defaults both protocols to their implicit-TLS ports", () => {
    const config = loadConfig(env());
    expect(config.imap).toMatchObject({ port: 993, secure: true });
    expect(config.smtp).toMatchObject({ port: 465, secure: true });
  });

  it("defaults to the STARTTLS ports when TLS is switched off", () => {
    const config = loadConfig(env({ IMAP_SECURE: "false", SMTP_SECURE: "0" }));
    expect(config.imap).toMatchObject({ port: 143, secure: false });
    expect(config.smtp).toMatchObject({ port: 587, secure: false });
  });

  it("keeps an explicit port when TLS is switched off", () => {
    const config = loadConfig(env({ IMAP_SECURE: "no", IMAP_PORT: "1143" }));
    expect(config.imap.port).toBe(1143);
  });

  it("defaults the mailboxes", () => {
    const config = loadConfig(env());
    expect(config.defaultMailbox).toBe("INBOX");
    expect(config.sentMailbox).toBe("Sent");
  });

  it("treats an empty SENT_MAILBOX as 'do not file a copy'", () => {
    expect(loadConfig(env({ SENT_MAILBOX: "" })).sentMailbox).toBe("");
  });

  it("treats a blank SENT_MAILBOX as the default, not as opting out", () => {
    expect(loadConfig(env({ SENT_MAILBOX: "   " })).sentMailbox).toBe("Sent");
  });
});

describe("loadConfig, parsing", () => {
  it("ignores a non-numeric or non-positive integer and falls back", () => {
    for (const value of ["abc", "0", "-5", ""]) {
      expect(loadConfig(env({ PORT: value })).port).toBe(8080);
    }
  });

  it("reads the false-ish spellings of a boolean", () => {
    for (const value of ["0", "false", "no", "off", "FALSE", " Off "]) {
      expect(loadConfig(env({ IMAP_SECURE: value })).imap.secure).toBe(false);
    }
  });

  it("treats any other value as true", () => {
    for (const value of ["1", "true", "yes", "ja"]) {
      expect(loadConfig(env({ IMAP_SECURE: value })).imap.secure).toBe(true);
    }
  });

  it("trims hosts and the user but never the password", () => {
    const config = loadConfig(env({ IMAP_HOST: " imap.example.com ", MAIL_PASSWORD: " geheim " }));
    expect(config.imap.host).toBe("imap.example.com");
    expect(config.imap.auth.pass).toBe(" geheim ");
  });

  it("uses the same credentials for both protocols", () => {
    const config = loadConfig(env());
    expect(config.imap.auth).toEqual(config.smtp.auth);
  });
});
