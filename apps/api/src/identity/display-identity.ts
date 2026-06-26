import { randomInt } from "node:crypto";
import { avatarBackgrounds, avatarSet, type DisplayIdentity } from "@fahhhchat/config";

/**
 * Generates the anonymous display name + avatar assigned to every user (guest or
 * logged-in) so they can chat without setup and without exposing real identity
 * (stories 13-15). This is the isolated "display identity" module the PRD calls
 * out: pure, framework-free, and unit-testable. Generation is server-authoritative
 * so matched strangers only ever see a server-assigned identity.
 *
 * Names are deliberately non-unique and anonymous (adjective + noun). The word
 * lists are curated to stay safe/neutral; the username *editing* slice (#11)
 * adds moderation for user-chosen names, which is out of scope here.
 */

/** Pick a uniform random element using a CSPRNG-backed picker. */
type Picker = <T>(items: readonly T[]) => T;

const cryptoPicker: Picker = (items) => items[randomInt(items.length)];

const ADJECTIVES = [
  "Mellow",
  "Cosmic",
  "Brave",
  "Quiet",
  "Sunny",
  "Clever",
  "Gentle",
  "Swift",
  "Lucky",
  "Curious",
  "Breezy",
  "Wandering",
  "Mighty",
  "Velvet",
  "Amber",
  "Nimble",
  "Jolly",
  "Frosty",
  "Stellar",
  "Wily"
] as const;

const NOUNS = [
  "Otter",
  "Comet",
  "Maple",
  "Falcon",
  "Pixel",
  "Willow",
  "Harbor",
  "Cipher",
  "Meadow",
  "Lantern",
  "Glacier",
  "Sparrow",
  "Pebble",
  "Cactus",
  "Aurora",
  "Badger",
  "Marble",
  "Canyon",
  "Thistle",
  "Beacon"
] as const;

/**
 * Produce a fresh {@link DisplayIdentity}. A {@link Picker} can be injected for
 * deterministic tests; production uses a crypto-backed uniform picker.
 */
export function generateDisplayIdentity(pick: Picker = cryptoPicker): DisplayIdentity {
  const displayName = `${pick(ADJECTIVES)} ${pick(NOUNS)}`;
  return {
    displayName,
    avatar: {
      avatarId: pick(avatarSet).id,
      backgroundColor: pick(avatarBackgrounds)
    }
  };
}
