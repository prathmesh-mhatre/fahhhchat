import { LegalPage, defaultRelatedPages } from "../legal-pages";

export default function ContactPage() {
  return (
    <LegalPage
      title="Contact"
      eyebrow="Support"
      summary="Public support and legal contact paths for general questions, legal notices, privacy requests, and safety concerns that do not belong in an active in-app report."
      status="Launch draft"
      effectiveNote="Final inboxes and response ownership needed before launch"
      related={defaultRelatedPages.filter((page) => page.href !== "/contact")}
      sections={[
        {
          title: "General support",
          body: "Placeholder: support@fahhhchat.example should be replaced with the production support inbox before public launch.",
        },
        {
          title: "Legal and privacy",
          body: "Placeholder: legal@fahhhchat.example and privacy@fahhhchat.example should be replaced with reviewed legal and privacy contact channels.",
        },
        {
          title: "Safety concerns",
          body: "Users should report unsafe behavior from inside the active chat when possible because in-app reports can include relevant match context. This public path is for general safety questions or follow-up when the in-app flow is unavailable.",
        },
        {
          title: "Account and appeals",
          body: "Logged-in appeal and account support flows are tracked in later MVP slices. Public copy should explain what information users need to provide without exposing private chat details.",
        },
      ]}
    />
  );
}
