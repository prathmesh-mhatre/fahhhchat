import { Badge, ButtonLink, Eyebrow } from "@fahhhchat/ui";

type LegalSection = {
  title: string;
  body: string;
  bullets?: string[];
};

type LegalPageProps = {
  title: string;
  eyebrow: string;
  summary: string;
  status: string;
  effectiveNote: string;
  sections: LegalSection[];
  related?: Array<{ href: string; label: string }>;
};

export function LegalPage({
  title,
  eyebrow,
  summary,
  status,
  effectiveNote,
  sections,
  related = [],
}: LegalPageProps) {
  return (
    <main className="legal-page" aria-labelledby="legal-title">
      <header className="legal-hero">
        <Eyebrow className="eyebrow">{eyebrow}</Eyebrow>
        <h1 id="legal-title">{title}</h1>
        <p className="legal-hero__summary">{summary}</p>
        <div className="legal-hero__meta" aria-label="Page review status">
          <Badge>{status}</Badge>
          <span>{effectiveNote}</span>
        </div>
      </header>

      <section className="legal-review" aria-labelledby="review-title">
        <div>
          <Eyebrow className="eyebrow">Founder and counsel review</Eyebrow>
          <h2 id="review-title">Launch placeholder, not final legal advice.</h2>
        </div>
        <p>
          This page is structured for review before public launch. Final legal
          language, support addresses, jurisdiction-specific notices, and
          production effective dates must be confirmed outside the engineering
          workflow.
        </p>
      </section>

      <section className="legal-sections" aria-label={`${title} sections`}>
        {sections.map((section) => (
          <article key={section.title}>
            <h2>{section.title}</h2>
            <p>{section.body}</p>
            {section.bullets ? (
              <ul>
                {section.bullets.map((bullet) => (
                  <li key={bullet}>{bullet}</li>
                ))}
              </ul>
            ) : null}
          </article>
        ))}
      </section>

      {related.length > 0 ? (
        <nav className="legal-related" aria-label="Related public pages">
          {related.map((link) => (
            <ButtonLink key={link.href} href={link.href} variant="secondary">
              {link.label}
            </ButtonLink>
          ))}
        </nav>
      ) : null}
    </main>
  );
}

export const defaultRelatedPages = [
  { href: "/terms", label: "Terms" },
  { href: "/privacy", label: "Privacy" },
  { href: "/community-guidelines", label: "Guidelines" },
  { href: "/safety", label: "Safety" },
  { href: "/contact", label: "Contact" },
];
