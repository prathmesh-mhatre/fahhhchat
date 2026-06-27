import { Test } from "@nestjs/testing";
import { ModerationModule } from "./moderation.module";
import { ModerationService } from "./moderation.service";

/**
 * Verifies the DI seam: the service resolves from the module and delegates to
 * the shared engine. Engine *behavior* is exhaustively covered in
 * moderation.engine.spec.ts; here we only confirm the wrapper passes through the
 * structured verdict and the block predicate honors the severity floor.
 */
describe("ModerationService", () => {
  let service: ModerationService;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ModerationModule],
    }).compile();
    service = moduleRef.get(ModerationService);
  });

  it("resolves from the module", () => {
    expect(service).toBeInstanceOf(ModerationService);
  });

  it("classifies a message into the structured verdict", () => {
    const clean = service.evaluateMessage("hey how's it going");
    expect(clean.severity).toBe("none");
    expect(clean.blocked).toBe(false);

    const slur = service.evaluateMessage("you faggot");
    expect(slur.severity).toBe("high");
    expect(slur.categories).toContain("slur");
  });

  it("classifies a username with its rejection code", () => {
    expect(service.evaluateUsername("Mellow Otter").rejectionCode).toBeNull();
    expect(service.evaluateUsername("admin").rejectionCode).toBe("reserved");
  });

  describe("shouldBlockMessage", () => {
    it("blocks low-severity content by default", () => {
      expect(service.shouldBlockMessage("just kill yourself")).toBe(true);
      expect(service.shouldBlockMessage("hey there")).toBe(false);
    });

    it("can require the high tier only (story 70)", () => {
      // Harassment is low: blocked at the default floor, allowed when only
      // hard-stopping the severe tier.
      expect(service.shouldBlockMessage("you are worthless", "high")).toBe(false);
      expect(service.shouldBlockMessage("i will kill you", "high")).toBe(true);
    });
  });
});
