import { moderateDisplayName, type DisplayNameRejectionCode } from "./username-moderation";

/** Assert a name is rejected with a specific reason code. */
function expectRejected(name: unknown, code: DisplayNameRejectionCode) {
  const result = moderateDisplayName(name);
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.code).toBe(code);
    expect(result.message).toEqual(expect.any(String));
  }
}

/** Assert a name is accepted and return the normalized value. */
function expectAccepted(name: string): string {
  const result = moderateDisplayName(name);
  expect(result.ok).toBe(true);
  if (!result.ok) {
    throw new Error(`expected "${name}" to be accepted, got ${result.code}`);
  }
  return result.value;
}

describe("moderateDisplayName", () => {
  it("accepts ordinary safe names", () => {
    expect(expectAccepted("Mellow Otter")).toBe("Mellow Otter");
    expect(expectAccepted("Captain Nova 7")).toBe("Captain Nova 7");
    expect(expectAccepted("O'Brien")).toBe("O'Brien");
    expect(expectAccepted("Anne-Marie")).toBe("Anne-Marie");
  });

  it("trims and collapses internal whitespace", () => {
    expect(expectAccepted("   Quiet    Harbor   ")).toBe("Quiet Harbor");
  });

  describe("length", () => {
    it("rejects empty / non-string input", () => {
      expectRejected("", "empty");
      expectRejected("   ", "empty");
      expectRejected(undefined, "empty");
      expectRejected(42, "empty");
    });

    it("rejects too short and too long", () => {
      expectRejected("ab", "too_short");
      expectRejected("x".repeat(40), "too_long");
    });
  });

  describe("unsafe content (story 18)", () => {
    it("rejects URLs and domains", () => {
      expectRejected("visit http://x.io", "url");
      expectRejected("www.evil.net", "url");
      expectRejected("findme.com", "url");
    });

    it("rejects contact info: emails, @, and phone-like digit runs", () => {
      expectRejected("me@gmail", "contact_info");
      expectRejected("call 5551234", "contact_info");
      expectRejected("555 123 4567", "contact_info");
    });

    it("rejects social handles / off-platform routing, including spaced evasions", () => {
      expectRejected("my insta handle", "social_handle");
      expectRejected("snapchat me", "social_handle");
      expectRejected("i n s t a g r a m", "social_handle");
    });

    it("rejects reserved platform terms", () => {
      expectRejected("admin", "reserved");
      expectRejected("Fahhhchat Support", "reserved");
      expectRejected("the moderator", "reserved");
    });

    it("rejects slurs, including punctuation/spacing evasions", () => {
      expectRejected("f.a.g", "slur");
    });

    it("rejects explicit sexual terms", () => {
      expectRejected("horny guy", "sexual");
      expectRejected("porn star", "sexual");
    });

    it("rejects disallowed characters that no specific rule caught", () => {
      expectRejected("weird~name", "invalid_characters");
      expectRejected("emoji 🦊 name", "invalid_characters");
    });
  });
});
