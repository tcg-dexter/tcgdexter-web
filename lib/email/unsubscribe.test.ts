import { describe, it, expect, beforeAll } from "vitest";
import { signUnsubToken, verifyUnsubToken } from "./unsubscribe";

const USER = "11111111-2222-3333-4444-555555555555";

beforeAll(() => {
  process.env.UNSUBSCRIBE_SECRET = "test-secret-abc";
});

describe("unsubscribe tokens", () => {
  it("round-trips a valid token back to the user id", () => {
    const token = signUnsubToken(USER);
    expect(verifyUnsubToken(token)).toBe(USER);
  });

  it("rejects a tampered signature", () => {
    const token = signUnsubToken(USER);
    const flipped = token.slice(0, -1) + (token.endsWith("a") ? "b" : "a");
    expect(verifyUnsubToken(flipped)).toBeNull();
  });

  it("rejects a swapped user id (signature no longer matches)", () => {
    const token = signUnsubToken(USER);
    const sig = token.slice(token.lastIndexOf(".") + 1);
    const forged = `99999999-0000-0000-0000-000000000000.${sig}`;
    expect(verifyUnsubToken(forged)).toBeNull();
  });

  it("rejects malformed / empty tokens", () => {
    expect(verifyUnsubToken(null)).toBeNull();
    expect(verifyUnsubToken("")).toBeNull();
    expect(verifyUnsubToken("no-dot-here")).toBeNull();
    expect(verifyUnsubToken(`${USER}.`)).toBeNull();
  });

  it("rejects a token signed under a different secret", () => {
    const token = signUnsubToken(USER);
    process.env.UNSUBSCRIBE_SECRET = "a-different-secret";
    expect(verifyUnsubToken(token)).toBeNull();
    process.env.UNSUBSCRIBE_SECRET = "test-secret-abc"; // restore
  });
});
