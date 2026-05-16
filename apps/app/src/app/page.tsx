import { ButtonLink, Eyebrow, Surface } from "@fahhhchat/ui";

export default function ChatEntryPage() {
  return (
    <main className="chat-shell" aria-labelledby="app-title">
      <Surface className="chat-panel">
        <div className="topbar">
          <span className="presence-dot" aria-hidden="true" />
          <span>Ready to match</span>
        </div>
        <div className="entry">
          <Eyebrow className="eyebrow">Guest chat is the fastest path</Eyebrow>
          <h1 id="app-title">Start as a stranger</h1>
          <p>
            Confirm you are 18+, accept the current rules, and get a generated anonymous identity
            before queueing for a one-to-one text match.
          </p>
          <div className="actions">
            <ButtonLink href="/guest">Continue as guest</ButtonLink>
            <ButtonLink href="/login" variant="secondary">
              Sign in with Google
            </ButtonLink>
          </div>
        </div>
        <div className="composer" aria-hidden="true">
          <span>Message composer placeholder</span>
          <button type="button">Send</button>
        </div>
      </Surface>
    </main>
  );
}
