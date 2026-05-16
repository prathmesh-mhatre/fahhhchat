import { LegalPage, defaultRelatedPages } from "../legal-pages";

export default function PrivacyPage() {
  return (
    <LegalPage
      title="Privacy"
      eyebrow="Public legal"
      summary="Draft privacy summary for guest sessions, optional Google login, moderation records, consent-sensitive analytics, and ephemeral chat/media handling."
      status="Launch draft"
      effectiveNote="Current privacy gate version: 2026-05-issue-1"
      related={defaultRelatedPages.filter((page) => page.href !== "/privacy")}
      sections={[
        {
          title: "Data used to run chat",
          body: "Fahhhchat uses essential data to create guest sessions, authenticate logged-in users, operate matching, enforce rate limits, and keep the service safe.",
        },
        {
          title: "Identity model",
          body: "Logged-in users authenticate with Google, but public chat identity uses generated names and avatars. Internal identifiers are used instead of raw Google IDs for product and safety analytics.",
        },
        {
          title: "Chat and report context",
          body: "Ordinary active-chat context is intended to be short-lived. Eligible surrounding text context is persisted when a report is filed so moderators can review safety incidents.",
          bullets: [
            "Guest data remains lightweight and session-oriented.",
            "Report and moderation records may be retained longer for safety and legal reasons.",
            "Media abuse reports store metadata and surrounding eligible text context, not image bytes.",
          ],
        },
        {
          title: "Analytics consent",
          body: "Essential safety and operational events can run before optional analytics consent. Region-aware privacy consent and analytics opt-in behavior are tracked in later implementation slices.",
        },
        {
          title: "Retention placeholders",
          body: "The PRD targets raw analytics retention for 90 days, longer aggregated metrics, and moderation/report retention for roughly 1-2 years. Counsel and founders should confirm exact production retention language.",
        },
      ]}
    />
  );
}
