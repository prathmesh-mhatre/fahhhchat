import { productConfig } from "@fahhhchat/config";
import { InMemoryRematchGuardStore } from "./in-memory-rematch-guard.store";
import { RematchGuardService } from "./rematch-guard.service";

function build() {
  const store = new InMemoryRematchGuardStore();
  return { service: new RematchGuardService(store), store };
}

describe("RematchGuardService (issue #27, stories 53-54)", () => {
  it("records a mutual exclusion so either side excludes the other", async () => {
    const { service } = build();

    await service.preventRematch("user:u1", "guest:g1");

    expect(await service.excludedKeysFor("user:u1")).toEqual(["guest:g1"]);
    expect(await service.excludedKeysFor("guest:g1")).toEqual(["user:u1"]);
  });

  it("accumulates multiple exclusions for the same identity", async () => {
    const { service } = build();

    await service.preventRematch("user:u1", "guest:g1");
    await service.preventRematch("user:u1", "guest:g2");

    expect((await service.excludedKeysFor("user:u1")).sort()).toEqual([
      "guest:g1",
      "guest:g2",
    ]);
  });

  it("prunes an exclusion once the prevention window lapses (story 54)", async () => {
    const { service } = build();
    const t0 = new Date("2026-06-28T00:00:00.000Z");
    await service.preventRematch("user:u1", "guest:g1", t0);

    // Just inside the window: still excluded.
    const inside = new Date(
      t0.getTime() + productConfig.rematchPreventionSeconds * 1000 - 1,
    );
    expect(await service.excludedKeysFor("user:u1", inside)).toEqual([
      "guest:g1",
    ]);

    // At/after the window: pruned and gone for both directions.
    const after = new Date(
      t0.getTime() + productConfig.rematchPreventionSeconds * 1000,
    );
    expect(await service.excludedKeysFor("user:u1", after)).toEqual([]);
    expect(await service.excludedKeysFor("guest:g1", after)).toEqual([]);
  });

  it("refreshes the window when the same pair is recorded again", async () => {
    const { service } = build();
    const t0 = new Date("2026-06-28T00:00:00.000Z");
    await service.preventRematch("user:u1", "guest:g1", t0);

    // Re-record later; the expiry should now extend from the second recording.
    const t1 = new Date(t0.getTime() + 1000 * 1000);
    await service.preventRematch("user:u1", "guest:g1", t1);

    // A time that would have been past the *first* window but is inside the
    // refreshed one still shows the exclusion.
    const between = new Date(
      t1.getTime() + productConfig.rematchPreventionSeconds * 1000 - 1,
    );
    expect(await service.excludedKeysFor("user:u1", between)).toEqual([
      "guest:g1",
    ]);
  });

  it("never excludes an identity from itself (corrupted call)", async () => {
    const { service } = build();

    await service.preventRematch("user:u1", "user:u1");

    expect(await service.excludedKeysFor("user:u1")).toEqual([]);
  });

  it("returns an empty list for an identity with no exclusions", async () => {
    const { service } = build();
    expect(await service.excludedKeysFor("guest:unknown")).toEqual([]);
  });
});
