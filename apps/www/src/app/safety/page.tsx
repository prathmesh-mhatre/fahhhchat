import { LegalPage, defaultRelatedPages } from "../legal-pages";

export default function SafetyPage() {
  return (
    <LegalPage
      title="Safety"
      eyebrow="Public safety"
      summary="How Fahhhchat is designed to reduce obvious abuse while keeping stranger chat fast, anonymous, and honest about its limits."
      status="Launch draft"
      effectiveNote="Safety copy requires founder and counsel approval"
      related={defaultRelatedPages.filter((page) => page.href !== "/safety")}
      sections={[
        {
          title: "Before the first chat",
          body: "Users must pass the adults-only legal gate and see concise safety expectations before their first chat. Updated guideline versions can be shown again when rules change.",
        },
        {
          title: "During a match",
          body: "Matches are one-to-one text conversations. The two-step Next control, Report, and Block all give users a clear way to leave the current interaction.",
        },
        {
          title: "Moderation approach",
          body: "The MVP uses deterministic safety checks and human review rather than AI moderation. The focus is slurs, threats, harassment, spam, underage signals, and illegal, unsafe, non-consensual, exploitative, or harassing sexual patterns.",
        },
        {
          title: "Camera media limits",
          body: "Camera sharing is logged-in only, per-match consent-based, view-once, and designed to expire aggressively. Fahhhchat does not promise screenshot prevention or screenshot detection in the MVP.",
        },
        {
          title: "Operational monitoring",
          body: "Launch operations include report review, abuse controls, rate limits, safety records, and alerts for elevated report rates or service health issues.",
        },
      ]}
    />
  );
}
