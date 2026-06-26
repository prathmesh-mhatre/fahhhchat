import {
  defaultGenderFilter,
  defaultLanguage,
  isGenderFilter,
  isLanguageCode,
  isUserGender,
  resolveLanguage
} from "@fahhhchat/config";

describe("language + gender preference helpers (stories 26-29)", () => {
  describe("resolveLanguage", () => {
    it("maps a region-qualified browser tag to its supported primary code", () => {
      expect(resolveLanguage("pt-BR")).toBe("pt");
      expect(resolveLanguage("EN-us")).toBe("en");
      expect(resolveLanguage("zh-Hans")).toBe("zh");
    });

    it("accepts a bare supported code", () => {
      expect(resolveLanguage("fr")).toBe("fr");
    });

    it("falls back to the default for unsupported or missing languages", () => {
      expect(resolveLanguage("xx-YY")).toBe(defaultLanguage);
      expect(resolveLanguage(undefined)).toBe(defaultLanguage);
      expect(resolveLanguage(42)).toBe(defaultLanguage);
    });
  });

  describe("isLanguageCode", () => {
    it("recognizes supported codes and rejects others", () => {
      expect(isLanguageCode("en")).toBe(true);
      expect(isLanguageCode("klingon")).toBe(false);
      expect(isLanguageCode("EN")).toBe(false);
      expect(isLanguageCode(undefined)).toBe(false);
    });
  });

  describe("isUserGender", () => {
    it("accepts the three declared options only", () => {
      expect(isUserGender("male")).toBe(true);
      expect(isUserGender("female")).toBe(true);
      expect(isUserGender("prefer_not_to_say")).toBe(true);
      expect(isUserGender("other")).toBe(false);
      expect(isUserGender("")).toBe(false);
    });
  });

  describe("isGenderFilter (stories 30-31)", () => {
    it("accepts Male, Female, or Both only", () => {
      expect(isGenderFilter("male")).toBe(true);
      expect(isGenderFilter("female")).toBe(true);
      expect(isGenderFilter("both")).toBe(true);
      expect(isGenderFilter("prefer_not_to_say")).toBe(false);
      expect(isGenderFilter("everyone")).toBe(false);
      expect(isGenderFilter(undefined)).toBe(false);
    });

    it('defaults to "both" so a filter never silently shrinks the match pool', () => {
      expect(defaultGenderFilter).toBe("both");
      expect(isGenderFilter(defaultGenderFilter)).toBe(true);
    });
  });
});
