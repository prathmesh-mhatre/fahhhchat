import {
  moderateText,
  moderateUsername,
  severityAtLeast,
  type ModerationCategory,
  type ModerationSeverity,
} from "@fahhhchat/config";

/**
 * Behavioral coverage of the deterministic rule engine (issue #31, stories
 * 66-68). Tests target *externally observable* verdicts — severity tier and
 * matched category — not the internal lexicon, and pin down the two failure
 * modes the PRD cares most about: catching the enumerated harms, and NOT
 * over-moderating ordinary profanity or consensual adult talk.
 */

function expectClean(text: string) {
  const result = moderateText(text);
  expect(result.severity).toBe<ModerationSeverity>("none");
  expect(result.blocked).toBe(false);
  expect(result.categories).toEqual([]);
}

function expectFlagged(
  text: string,
  severity: ModerationSeverity,
  category: ModerationCategory,
) {
  const result = moderateText(text);
  expect(result.severity).toBe(severity);
  expect(result.blocked).toBe(true);
  expect(result.categories).toContain(category);
}

describe("moderateText", () => {
  describe("non-blocking cases (stories 67-68)", () => {
    it("returns a clean verdict for empty / non-string input", () => {
      expectClean("");
      expectClean("   ");
      expect(moderateText(undefined).severity).toBe("none");
      expect(moderateText(42).severity).toBe("none");
    });

    it("does not block ordinary chat", () => {
      expectClean("hey how are you doing today");
      expectClean("what music are you into?");
      expectClean("lol that traffic was killing me this morning");
    });

    it("does not block ordinary profanity (story 67)", () => {
      expectClean("fuck this is so annoying");
      expectClean("what the hell, this shit is broken");
      expectClean("you're being an asshole right now");
    });

    it("does not blanket-ban consensual adult sexual talk (story 68)", () => {
      expectClean("are you into anything fun tonight");
      expectClean("i think you're really hot");
      expectClean("want to have sex sometime");
    });
  });

  describe("slurs -> high (story 74)", () => {
    it("flags slurs", () => {
      expectFlagged("you are such a faggot", "high", "slur");
      expectFlagged("typical chink behavior", "high", "slur");
    });

    it("catches spacing/punctuation and leetspeak evasions", () => {
      expectFlagged("n i g g e r", "high", "slur");
      expectFlagged("f.a.g.g.o.t", "high", "slur");
      expectFlagged("n1gg3r", "high", "slur");
    });
  });

  describe("threats -> high (story 70)", () => {
    it("flags directed threats", () => {
      expectFlagged("i will kill you", "high", "threat");
      expectFlagged("im gonna find you", "high", "threat");
      expectFlagged("i know where you live", "high", "threat");
      expectFlagged("hope you die", "high", "threat");
    });

    it("does not flag the same verbs used non-threateningly", () => {
      expectClean("this workout is killing me");
      expectClean("that movie was a real killer");
    });
  });

  describe("underage signals (story 68)", () => {
    it("flags an underage age statement on its own as low (for review)", () => {
      expectFlagged("hi im 14 and bored", "low", "underage");
      expectFlagged("im 15 years old", "low", "underage");
    });

    it("escalates underage + sexual context to high", () => {
      expectFlagged("im 14 and horny", "high", "underage");
      expectFlagged("send nudes im 13", "high", "underage");
      expectFlagged("looking for a schoolgirl to sext", "high", "underage");
    });

    it("does not flag an adult age statement", () => {
      expectClean("im 27 and from chicago");
      expectClean("im 21 years old");
    });
  });

  describe("non-consensual / exploitative sexual patterns -> high (story 68)", () => {
    it("flags named exploitative acts regardless of phrasing", () => {
      expectFlagged("talk about rape fantasies", "high", "sexual_exploitation");
      expectFlagged("into incest stuff", "high", "sexual_exploitation");
    });
  });

  describe("harassment -> low (story 69)", () => {
    it("flags directed self-harm goading and dehumanizing attacks", () => {
      expectFlagged("just kill yourself", "low", "harassment");
      expectFlagged("kys loser", "low", "harassment");
      expectFlagged("you are worthless", "low", "harassment");
    });
  });

  describe("spam / scams -> low", () => {
    it("flags scam and off-platform-routing phrasing", () => {
      expectFlagged("free followers click here", "low", "spam");
      expectFlagged("check out my profile", "low", "spam");
      expectFlagged("dm me on instagram", "low", "social_handle");
    });
  });

  describe("structured result", () => {
    it("reports all matched categories and the max severity", () => {
      const result = moderateText("kill yourself you faggot");
      expect(result.severity).toBe("high");
      expect(result.categories).toEqual(
        expect.arrayContaining<ModerationCategory>(["slur", "harassment"]),
      );
      expect(result.matches.length).toBeGreaterThanOrEqual(2);
    });
  });
});

describe("severityAtLeast", () => {
  it("orders none < low < high", () => {
    expect(severityAtLeast("high", "low")).toBe(true);
    expect(severityAtLeast("low", "low")).toBe(true);
    expect(severityAtLeast("low", "high")).toBe(false);
    expect(severityAtLeast("none", "low")).toBe(false);
  });
});

describe("moderateUsername (story 18)", () => {
  it("accepts clean names", () => {
    expect(moderateUsername("Mellow Otter").blocked).toBe(false);
    expect(moderateUsername("Captain Nova 7").rejectionCode).toBeNull();
  });

  it("rejects URLs and contact info", () => {
    expect(moderateUsername("visit findme.com").rejectionCode).toBe("url");
    expect(moderateUsername("me@gmail").rejectionCode).toBe("contact_info");
    expect(moderateUsername("call 5551234").rejectionCode).toBe("contact_info");
  });

  it("rejects social handles, including spaced evasions", () => {
    expect(moderateUsername("my insta handle").rejectionCode).toBe("social_handle");
    expect(moderateUsername("snapchat me").rejectionCode).toBe("social_handle");
  });

  it("rejects reserved platform terms", () => {
    expect(moderateUsername("admin").rejectionCode).toBe("reserved");
    expect(moderateUsername("Fahhhchat Support").rejectionCode).toBe("reserved");
  });

  it("rejects slurs and any sexual term (stricter than chat)", () => {
    expect(moderateUsername("f.a.g.g.o.t").rejectionCode).toBe("slur");
    expect(moderateUsername("horny guy").rejectionCode).toBe("sexual");
    expect(moderateUsername("porn star").rejectionCode).toBe("sexual");
  });

  it("returns a high-severity structured verdict when rejected", () => {
    const result = moderateUsername("admin");
    expect(result.severity).toBe("high");
    expect(result.blocked).toBe(true);
    expect(result.categories).toContain<ModerationCategory>("reserved");
  });
});
