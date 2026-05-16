export default function SafetyPage() {
  return (
    <main className="summary" aria-labelledby="safety-title">
      <article>
        <h1 id="safety-title">Safety</h1>
        <p>
          Fahhhchat is for adults only. Reports, blocking, moderation checks, and admin review are
          part of the launch scope.
        </p>
      </article>
      <article>
        <h2>Camera media</h2>
        <p>
          Camera sharing is consent-based, available only when both matched users are logged in,
          and view-once behavior does not prevent screenshots.
        </p>
      </article>
    </main>
  );
}
