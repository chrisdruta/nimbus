import { describe, expect, test } from "bun:test";
import {
  generateInviteCode,
  hashInviteCode,
  inviteStatus,
} from "../lib/server/invites";

const NOW = new Date("2026-07-12T12:00:00Z");
const PAST = new Date("2026-07-10T00:00:00Z");
const FUTURE = new Date("2026-07-19T00:00:00Z");

function invite(overrides: {
  used_at?: Date | null;
  revoked_at?: Date | null;
  expires_at?: Date;
}) {
  return {
    used_at: overrides.used_at ?? null,
    revoked_at: overrides.revoked_at ?? null,
    expires_at: overrides.expires_at ?? FUTURE,
  };
}

describe("inviteStatus", () => {
  test("fresh invite is active", () => {
    expect(inviteStatus(invite({}), NOW)).toBe("active");
  });

  test("used wins over everything", () => {
    expect(
      inviteStatus(
        invite({ used_at: PAST, revoked_at: PAST, expires_at: PAST }),
        NOW,
      ),
    ).toBe("used");
  });

  test("revoked wins over expired", () => {
    expect(
      inviteStatus(invite({ revoked_at: PAST, expires_at: PAST }), NOW),
    ).toBe("revoked");
  });

  test("expired when past expires_at", () => {
    expect(inviteStatus(invite({ expires_at: PAST }), NOW)).toBe("expired");
  });

  test("expires exactly at the boundary", () => {
    expect(inviteStatus(invite({ expires_at: NOW }), NOW)).toBe("expired");
  });

  test("still active one ms before expiry", () => {
    expect(
      inviteStatus(invite({ expires_at: new Date(NOW.getTime() + 1) }), NOW),
    ).toBe("active");
  });
});

describe("generateInviteCode", () => {
  test("is 22-char base64url", () => {
    const code = generateInviteCode();
    expect(code).toHaveLength(22);
    expect(code).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  test("codes are unique across draws", () => {
    const codes = new Set(
      Array.from({ length: 200 }, () => generateInviteCode()),
    );
    expect(codes.size).toBe(200);
  });
});

describe("hashInviteCode", () => {
  test("produces 64 lowercase hex chars", () => {
    expect(hashInviteCode(generateInviteCode())).toMatch(/^[0-9a-f]{64}$/);
  });

  test("is deterministic and input-sensitive", () => {
    const code = generateInviteCode();
    expect(hashInviteCode(code)).toBe(hashInviteCode(code));
    expect(hashInviteCode(code)).not.toBe(hashInviteCode(code + "x"));
  });

  test("matches the SHA-256 vector the schema backfill must reproduce", () => {
    // encode(sha256(convert_to('abc','UTF8')),'hex') in Postgres.
    expect(hashInviteCode("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });
});
