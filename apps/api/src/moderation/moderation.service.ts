import { Injectable } from "@nestjs/common";
import {
  moderateText,
  moderateUsername,
  severityAtLeast,
  type ModerationResult,
  type ModerationSeverity,
  type UsernameRejectionCode,
} from "@fahhhchat/config";

/**
 * Injectable wrapper over the shared, framework-free moderation rule engine
 * ({@link import("@fahhhchat/config")}). The engine itself is a pure function so
 * it can be unit-tested in isolation (one of the deep modules the PRD calls out,
 * `issues/prd.md`); this service is the NestJS seam other slices depend on —
 * the chat path (#21/#32) will call {@link evaluateMessage} before delivery, and
 * the identity layer can call {@link evaluateUsername} from one shared engine.
 *
 * Keeping enforcement *out* of here is deliberate: this slice (#31) only
 * classifies. Mapping a {@link ModerationResult} to an action — warn,
 * rate-limit, auto-end, escalate (stories 69-70, 73-74) — is the #32 slice's
 * job and will consume this service's structured verdict.
 */
@Injectable()
export class ModerationService {
  /**
   * Classify a chat message. Returns the structured verdict; never throws and
   * never mutates the text (moderation observes, it does not rewrite). Empty or
   * non-string input resolves to a clean `none` result.
   */
  evaluateMessage(text: unknown): ModerationResult {
    return moderateText(text);
  }

  /**
   * Classify a proposed username (story 18). Same structured verdict plus the
   * specific {@link UsernameRejectionCode} for the user-facing message when the
   * name is rejected.
   */
  evaluateUsername(
    name: unknown,
  ): ModerationResult & { rejectionCode: UsernameRejectionCode | null } {
    return moderateUsername(name);
  }

  /**
   * Convenience predicate for the chat path: should this message be refused
   * delivery? True once any rule of at least {@link minSeverity} fired. Defaults
   * to `low`, matching {@link ModerationResult.blocked}; callers that only want
   * to hard-stop the severe tier (story 70) pass `high`.
   */
  shouldBlockMessage(
    text: unknown,
    minSeverity: ModerationSeverity = "low",
  ): boolean {
    const result = this.evaluateMessage(text);
    return (
      result.severity !== "none" &&
      severityAtLeast(result.severity, minSeverity)
    );
  }
}
