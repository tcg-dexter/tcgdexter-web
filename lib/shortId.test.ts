import { describe, it, expect } from "vitest";
import { isUuid, idColumn } from "./shortId";

describe("isUuid", () => {
  it("accepts a canonical lowercase UUID", () => {
    expect(isUuid("3f2504e0-4f89-11d3-9a0c-0305e82c3301")).toBe(true);
  });

  it("accepts uppercase UUIDs", () => {
    expect(isUuid("3F2504E0-4F89-11D3-9A0C-0305E82C3301")).toBe(true);
  });

  it("rejects an 8-char short_id", () => {
    expect(isUuid("k8m2x7q9")).toBe(false);
  });

  it("rejects short_ids using the URL-safe extras in the alphabet", () => {
    // generate_match_short_id() draws from [A-Za-z0-9_-], so both of these
    // are legitimate ids that must never be mistaken for a UUID.
    expect(isUuid("_-aZ09_-")).toBe(false);
    expect(isUuid("--------")).toBe(false);
  });

  it("rejects a UUID missing its dashes", () => {
    expect(isUuid("3f2504e04f8911d39a0c0305e82c3301")).toBe(false);
  });

  it("rejects values that merely contain a UUID", () => {
    expect(isUuid(" 3f2504e0-4f89-11d3-9a0c-0305e82c3301")).toBe(false);
    expect(isUuid("3f2504e0-4f89-11d3-9a0c-0305e82c3301x")).toBe(false);
  });

  it("rejects the empty string", () => {
    expect(isUuid("")).toBe(false);
  });
});

describe("idColumn", () => {
  it("routes UUID-shaped params to the id column (legacy links)", () => {
    expect(idColumn("3f2504e0-4f89-11d3-9a0c-0305e82c3301")).toBe("id");
  });

  it("routes everything else to short_id (the current URL form)", () => {
    expect(idColumn("k8m2x7q9")).toBe("short_id");
    expect(idColumn("_-aZ09_-")).toBe("short_id");
  });
});
