import { describe, it, expect } from "vitest";
import {
  isTrustedCardImageUrl,
  TRUSTED_CARD_IMAGE_PREFIXES,
} from "./cardImages";

/**
 * Security regression tests for the cover-image allowlist.
 *
 * `isTrustedCardImageUrl` is the ONLY thing standing between user input and a
 * stored `cover_image_url` that gets rendered as `<img src>` on every surface
 * that shows a deck (home, /my-decks, public /u and /d pages, OG images). It's
 * validated on write in both POST /api/saved-decks and PATCH /api/saved-decks/[id].
 *
 * The check is a `startsWith` prefix match. That is safe against host-spoofing
 * ONLY because every prefix includes the trailing "/" that terminates the URL
 * authority — so nothing after it can change the host. These tests lock that
 * property in: if someone ever drops a trailing slash (making
 * "https://images.pokemontcg.io.evil.com/x" pass) or adds a scheme-less/host
 * -less entry, the host-spoofing cases below start failing.
 */
describe("isTrustedCardImageUrl", () => {
  it("accepts URLs from each trusted host", () => {
    expect(
      isTrustedCardImageUrl("https://images.pokemontcg.io/sv1/1.png"),
    ).toBe(true);
    expect(
      isTrustedCardImageUrl("https://images.scrydex.com/pokemon/me4-1/small"),
    ).toBe(true);
    expect(
      isTrustedCardImageUrl(
        "https://limitlesstcg.nyc3.digitaloceanspaces.com/tpci/MEG/MEG_001_R_EN_LG.png",
      ),
    ).toBe(true);
  });

  it("rejects lookalike hosts that embed a trusted host as a subdomain suffix", () => {
    // Classic bypass: attacker-controlled apex domain, trusted host as a
    // subdomain label. Must be rejected.
    expect(
      isTrustedCardImageUrl("https://images.pokemontcg.io.evil.com/x.png"),
    ).toBe(false);
    expect(
      isTrustedCardImageUrl("https://images.scrydex.com.evil.com/x.png"),
    ).toBe(false);
  });

  it("rejects the userinfo (@) host-spoofing trick", () => {
    // "https://images.pokemontcg.io@evil.com/" resolves to host evil.com. The
    // trailing slash in every prefix is what makes this fail the startsWith.
    expect(
      isTrustedCardImageUrl("https://images.pokemontcg.io@evil.com/x.png"),
    ).toBe(false);
    expect(
      isTrustedCardImageUrl(
        "https://images.pokemontcg.io.evil.com@evil.com/x.png",
      ),
    ).toBe(false);
  });

  it("rejects a trusted host placed in the path of another origin", () => {
    expect(
      isTrustedCardImageUrl("https://evil.com/https://images.pokemontcg.io/x.png"),
    ).toBe(false);
    expect(
      isTrustedCardImageUrl("https://evil.com/?u=https://images.scrydex.com/x"),
    ).toBe(false);
  });

  it("rejects non-https schemes on trusted hosts", () => {
    // Only https prefixes are on the allowlist; http:// and protocol-relative
    // forms must not slip through.
    expect(
      isTrustedCardImageUrl("http://images.pokemontcg.io/sv1/1.png"),
    ).toBe(false);
    expect(
      isTrustedCardImageUrl("//images.pokemontcg.io/sv1/1.png"),
    ).toBe(false);
  });

  it("rejects dangerous non-http schemes outright", () => {
    expect(isTrustedCardImageUrl("javascript:alert(1)")).toBe(false);
    expect(
      isTrustedCardImageUrl(
        "data:image/svg+xml,<svg onload=alert(1)></svg>",
      ),
    ).toBe(false);
  });

  it("rejects empty / whitespace / junk input", () => {
    expect(isTrustedCardImageUrl("")).toBe(false);
    expect(isTrustedCardImageUrl("   ")).toBe(false);
    expect(isTrustedCardImageUrl("not a url")).toBe(false);
    // Leading whitespace defeats startsWith — must be rejected, not trimmed.
    expect(
      isTrustedCardImageUrl(" https://images.pokemontcg.io/sv1/1.png"),
    ).toBe(false);
  });

  it("every allowlist prefix is https and terminates the URL authority with a slash", () => {
    // The invariant the whole check depends on. A prefix without a trailing
    // slash after its host would allow host-suffix spoofing.
    for (const prefix of TRUSTED_CARD_IMAGE_PREFIXES) {
      expect(prefix.startsWith("https://")).toBe(true);
      const afterScheme = prefix.slice("https://".length);
      expect(afterScheme).toContain("/");
      expect(prefix.endsWith("/")).toBe(true);
    }
  });
});
