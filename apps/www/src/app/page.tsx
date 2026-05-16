import { ButtonLink, Eyebrow } from "@fahhhchat/ui";

export default function HomePage() {
  return (
    <main className="home">
      <section className="hero" aria-labelledby="hero-title">
        <div className="hero__content">
          <Eyebrow className="eyebrow">Anonymous realtime chat</Eyebrow>
          <h1 id="hero-title">Fahhhchat</h1>
          <p className="lede">
            Meet a stranger instantly, keep your real identity private, and move on with a
            fast two-step Next flow when the conversation is done.
          </p>
          <div className="actions">
            <ButtonLink href="http://localhost:3001">Start chatting</ButtonLink>
            <ButtonLink href="/safety" variant="secondary">
              Read safety notes
            </ButtonLink>
          </div>
        </div>
      </section>
      <section className="summary" aria-label="Product summary">
        <article>
          <h2>Guest first</h2>
          <p>Start with an anonymous generated name after the 18+ and legal gate.</p>
        </article>
        <article>
          <h2>Logged-in perks</h2>
          <p>Google login unlocks persistent preferences, gender filters, and media eligibility.</p>
        </article>
        <article>
          <h2>Safety built in</h2>
          <p>Reports, blocking, moderation, rate limits, and admin review are MVP foundations.</p>
        </article>
      </section>
    </main>
  );
}
