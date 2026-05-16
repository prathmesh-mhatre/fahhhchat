import { ButtonLink, Eyebrow } from "@fahhhchat/ui";

const trustItems = [
  "Adults-only entry with current Terms and Privacy acceptance",
  "Generated display names and avatars instead of real identities",
  "Reports, blocking, moderation records, and admin review from launch"
];

const featureCards = [
  {
    title: "Start as a guest",
    body: "The fastest path is anonymous guest chat after the 18+ and legal gate. Guest identity stays scoped to the browser session."
  },
  {
    title: "Sign in when it helps",
    body: "Google login is optional and unlocks persistent preferences, generated identity continuity, gender filters, and camera media eligibility."
  },
  {
    title: "Move on cleanly",
    body: "A two-step Next action closes the current match and queues the next one without public online counts or pressure tactics."
  }
];

const safetyCards = [
  {
    title: "Safety expectations",
    body: "Before the first chat, users see concise guidelines covering adult-only use, respectful behavior, reports, and blocking."
  },
  {
    title: "Moderation foundation",
    body: "Launch scope includes deterministic abuse checks, rate limits, report queues, and durable safety records for review."
  },
  {
    title: "Honest camera media",
    body: "Camera sharing is logged-in only, requires consent from both matched users, expires aggressively, and never promises screenshot prevention."
  }
];

export default function HomePage() {
  return (
    <main className="home">
      <section className="hero" aria-labelledby="hero-title">
        <div className="hero__scene" aria-hidden="true">
          <div className="scene__topbar">
            <span />
            <span />
            <span />
          </div>
          <div className="scene__thread">
            <div className="scene__message scene__message--left">
              <span className="scene__avatar" />
              <p>Matched with River Lantern</p>
            </div>
            <div className="scene__message scene__message--right">
              <p>Hey, quick chat?</p>
              <span className="scene__avatar scene__avatar--warm" />
            </div>
            <div className="scene__message scene__message--left scene__message--wide">
              <span className="scene__avatar" />
              <p>Sure. I like that real names stay out of this.</p>
            </div>
            <div className="scene__status">Camera locked until both users consent</div>
          </div>
        </div>
        <div className="hero__content">
          <Eyebrow className="eyebrow">Anonymous realtime chat</Eyebrow>
          <h1 id="hero-title">Fahhhchat</h1>
          <p className="lede">
            Meet a stranger for one-to-one text chat, keep real identity private, and decide
            whether to stay anonymous or sign in for stronger controls.
          </p>
          <div className="actions">
            <ButtonLink href="http://localhost:3001">Start chatting</ButtonLink>
            <ButtonLink href="/safety" variant="secondary">
              Safety basics
            </ButtonLink>
          </div>
          <ul className="hero__trust" aria-label="Launch commitments">
            {trustItems.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      </section>

      <section className="intro" aria-labelledby="intro-title">
        <div>
          <Eyebrow className="eyebrow">Fast by default</Eyebrow>
          <h2 id="intro-title">A stranger chat flow built for low friction and clear boundaries.</h2>
        </div>
        <p>
          Fahhhchat starts with anonymous text matching and keeps the MVP focused: no voice,
          no video, no public online counts, no long-lived chat history, and no promise that
          view-once media can stop screenshots.
        </p>
      </section>

      <section className="summary" aria-label="Product summary">
        {featureCards.map((card) => (
          <article key={card.title}>
            <h2>{card.title}</h2>
            <p>{card.body}</p>
          </article>
        ))}
      </section>

      <section className="split" aria-labelledby="guest-title">
        <div className="split__content">
          <Eyebrow className="eyebrow">Guest access</Eyebrow>
          <h2 id="guest-title">Try a chat without handing over a profile.</h2>
          <p>
            Guests can begin after confirming adult status and accepting the current legal
            versions. The app assigns a generated name and avatar, then places everyone in
            the shared matching pool so wait times stay low.
          </p>
        </div>
        <div className="steps" aria-label="Guest flow">
          <span>18+ confirmation</span>
          <span>Terms and Privacy</span>
          <span>Generated identity</span>
          <span>One-to-one text match</span>
        </div>
      </section>

      <section className="split split--reverse" aria-labelledby="login-title">
        <div className="split__content">
          <Eyebrow className="eyebrow">Optional login</Eyebrow>
          <h2 id="login-title">Google login adds continuity without exposing Google identity.</h2>
          <p>
            Logged-in users still appear through generated names and avatars. Signing in
            supports persistent preferences, gender filter eligibility, appeals, account
            deletion, and camera media only when both matched people are logged in.
          </p>
        </div>
        <div className="benefit-list" aria-label="Logged-in benefits">
          <span>Persistent preferences</span>
          <span>Gender filters as guidance</span>
          <span>Consent-based camera media</span>
          <span>Account controls</span>
        </div>
      </section>

      <section className="safety-band" aria-labelledby="safety-title">
        <div className="section-heading">
          <Eyebrow className="eyebrow">Safety first</Eyebrow>
          <h2 id="safety-title">Built to explain the rules before the first match.</h2>
        </div>
        <div className="safety-grid">
          {safetyCards.map((card) => (
            <article key={card.title}>
              <h3>{card.title}</h3>
              <p>{card.body}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="final-cta" aria-labelledby="cta-title">
        <div>
          <Eyebrow className="eyebrow">Ready when you are</Eyebrow>
          <h2 id="cta-title">Start with text. Keep control. Leave anytime.</h2>
        </div>
        <div className="actions">
          <ButtonLink href="http://localhost:3001">Open the chat app</ButtonLink>
          <ButtonLink href="/community-guidelines" variant="secondary">
            Community guidelines
          </ButtonLink>
        </div>
      </section>
    </main>
  );
}
