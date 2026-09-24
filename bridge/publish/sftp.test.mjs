import { describe, expect, it } from "vitest";
import { fingerprintOf, fingerprintsMatch, keyTypeOf } from "./sftp.mjs";

/** Host key checks that need no server: the key blob is only bytes. */

const blob = (name, rest = Buffer.from([1, 2, 3])) => {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(name.length, 0);
  return Buffer.concat([length, Buffer.from(name, "latin1"), rest]);
};

describe("keyTypeOf", () => {
  for (const name of ["ssh-ed25519", "ecdsa-sha2-nistp256", "ssh-rsa"]) {
    it(`reads ${name} from the blob`, () => {
      expect(keyTypeOf(blob(name))).toBe(name);
    });
  }

  it("says unknown for a blob too short to name anything", () => {
    expect(keyTypeOf(Buffer.from([0, 0]))).toBe("unknown");
    expect(keyTypeOf(undefined)).toBe("unknown");
  });

  it("says unknown when the declared length runs past the blob", () => {
    const truncated = Buffer.from([0, 0, 0, 20, 0x73, 0x73, 0x68]);
    expect(keyTypeOf(truncated)).toBe("unknown");
  });

  it("does not quote bytes that are not an algorithm name", () => {
    expect(keyTypeOf(blob("ssh\nrsa"))).toBe("unknown");
  });
});

describe("fingerprintsMatch", () => {
  it("accepts OpenSSH's form, without padding, against a padded one", () => {
    const key = blob("ssh-ed25519");
    const printed = fingerprintOf(key);
    expect(fingerprintsMatch(printed, `${printed}=`)).toBe(true);
    expect(fingerprintsMatch(printed, printed.replace(/^SHA256:/, ""))).toBe(true);
  });

  it("refuses the fingerprint of another key", () => {
    expect(
      fingerprintsMatch(fingerprintOf(blob("ssh-ed25519")), fingerprintOf(blob("ssh-rsa")))
    ).toBe(false);
  });
});
