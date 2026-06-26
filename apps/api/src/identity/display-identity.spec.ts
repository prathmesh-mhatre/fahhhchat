import { avatarBackgrounds, avatarSet } from "@fahhhchat/config";
import { generateDisplayIdentity } from "./display-identity";

describe("generateDisplayIdentity", () => {
  it("produces a two-word adjective + noun display name", () => {
    const { displayName } = generateDisplayIdentity();
    const words = displayName.split(" ");
    expect(words).toHaveLength(2);
    expect(words.every((word) => /^[A-Z][a-z]+$/.test(word))).toBe(true);
  });

  it("picks an avatar id and background from the shared built-in sets", () => {
    const { avatar } = generateDisplayIdentity();
    expect(avatarSet.map((entry) => entry.id)).toContain(avatar.avatarId);
    expect(avatarBackgrounds).toContain(avatar.backgroundColor as (typeof avatarBackgrounds)[number]);
  });

  it("is deterministic for a given picker (testability hook)", () => {
    // A picker that always takes the first element yields a stable identity.
    const first = generateDisplayIdentity((items) => items[0]);
    const again = generateDisplayIdentity((items) => items[0]);
    expect(first).toEqual(again);
    expect(first.avatar.avatarId).toBe(avatarSet[0].id);
    expect(first.avatar.backgroundColor).toBe(avatarBackgrounds[0]);
  });

  it("varies across the vocabulary rather than emitting one constant identity", () => {
    const names = new Set(Array.from({ length: 50 }, () => generateDisplayIdentity().displayName));
    // 50 draws over a large vocabulary should virtually never collapse to one name.
    expect(names.size).toBeGreaterThan(1);
  });
});
