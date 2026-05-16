import { LegalPage, defaultRelatedPages } from "../legal-pages";

export default function CommunityGuidelinesPage() {
  return (
    <LegalPage
      title="Community Guidelines"
      eyebrow="Public safety"
      summary="Concise draft rules for adults-only stranger chat, written to match the safety reminders shown before first chat and after relevant enforcement events."
      status="Launch draft"
      effectiveNote="Current guidelines version: 2026-05-issue-1"
      related={defaultRelatedPages.filter(
        (page) => page.href !== "/community-guidelines",
      )}
      sections={[
        {
          title: "Adults only",
          body: "Do not use Fahhhchat if you are under 18. Do not ask for, request, share, or encourage underage sexual content or underage contact.",
        },
        {
          title: "Respect and consent",
          body: "Treat strangers like real people. Do not harass, threaten, shame, coerce, dox, impersonate, or keep pushing sexual conversation after someone says no or moves on.",
        },
        {
          title: "No scams or contact harvesting",
          body: "Do not spam, phish, solicit money, share malicious links, or pressure strangers to move to external contact channels.",
        },
        {
          title: "Media boundaries",
          body: "Camera media requires consent from both matched users and can be revoked during the match. View-once media can still be captured by screenshots or another device.",
        },
        {
          title: "Report and block",
          body: "Use Report for unsafe behavior and Block when you do not want to meet that person again. Reporting and blocking are available to guests and logged-in users.",
        },
      ]}
    />
  );
}
