import { ButtonLink, Eyebrow, Surface } from "@fahhhchat/ui";
import { CameraAffordance } from "../components/CameraAffordance";

export default function ChatEntryPage() {
  return (
    <main className="chat-shell" aria-labelledby="app-title">
      <Surface className="chat-panel">
        <div className="topbar">
          <span className="presence-dot" aria-hidden="true" />
          <span>Ready to match</span>
          {/*
           * The camera affordance is always visible but locked until both
           * matched users are logged in and the camera-media kill switch is on
           * (issue #38, stories 97, 125-126). Before a match exists the viewer
           * here is treated as a guest, so it renders locked with a "sign in"
           * explanation; the live match screen (later slices) will feed the real
           * viewer/partner login bits and the polled feature-flag state in.
           */}
          <CameraAffordance
            inputs={{
              viewerLoggedIn: false,
              partnerLoggedIn: false,
              cameraMediaFlagEnabled: true,
            }}
          />
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
