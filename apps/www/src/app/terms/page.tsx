import { LegalPage, defaultRelatedPages } from "../legal-pages";

export default function TermsPage() {
  return (
    <LegalPage
      title="Terms"
      eyebrow="Public legal"
      summary="Draft operating terms for an adults-only anonymous one-to-one text chat service with guest access, optional Google login, safety enforcement, and consent-based camera media."
      status="Launch draft"
      effectiveNote="Current legal gate version: 2026-05-issue-1"
      related={defaultRelatedPages.filter((page) => page.href !== "/terms")}
      sections={[
        {
          title: "Eligibility",
          body: "Fahhhchat is for adults only. Users must confirm they are 18 or older and accept the current Terms and Privacy version before entering the chat queue.",
        },
        {
          title: "Anonymous chat behavior",
          body: "Users are matched for one-to-one stranger text chat through generated display names and avatars. Real Google identity is not displayed to strangers.",
          bullets: [
            "Guest identity is session-scoped.",
            "Logged-in identity supports persistent preferences and account controls.",
            "The product does not provide public online counts or long-lived chat history in the MVP.",
          ],
        },
        {
          title: "Safety enforcement",
          body: "Reports, blocks, rate limits, moderation review, warnings, cooldowns, and bans are part of the launch scope. Reporting or blocking ends the current match and helps prevent immediate rematch.",
        },
        {
          title: "Camera media",
          body: "Camera media is eligible only when both matched users are logged in and both consent for the match. View-once behavior and expiration reduce exposure but cannot prevent screenshots or external recording.",
        },
        {
          title: "Founder review notes",
          body: "Counsel should finalize governing law, dispute terms, prohibited conduct language, user content rights, enforcement discretion, account deletion effects, and age-restriction compliance before public launch.",
        },
      ]}
    />
  );
}
