export default function LoginPage() {
  return (
    <main className="chat-shell" aria-labelledby="login-title">
      <section className="chat-panel">
        <div className="topbar">Google login</div>
        <div className="entry">
          <p className="eyebrow">Next slice</p>
          <h1 id="login-title">Sign in privately</h1>
          <p>
            Auth.js Google login will be implemented in its own vertical slice. Matched strangers
            will never see Google profile details.
          </p>
        </div>
      </section>
    </main>
  );
}
