# Stranger Chat MVP Decision Log

This document captures the agreed MVP decisions from the client brief grilling session.

## Product Scope

- Build a real production MVP, not only a demo.
- Launch with live random users, moderation, authentication, and ephemeral media.
- Keep the first release narrow: text chat, Google login, guest mode, gender filters, camera-only media, reporting/blocking, moderation foundations, and admin tooling.
- Defer voice chat, video chat, AI matchmaking, subscriptions, mobile apps, creator/community systems, gamification, and streaks.
- Public launch from day one, not invite-only/private beta.
- Use feature flags/kill switches for camera media, gender filters, guest access, and queue entry.
- Product safety/admin feature flags live in database settings, with caching and audit logs.

## Web Presence

- Marketing site lives at `www.xyz.com`.
- Chat app lives at `app.xyz.com`.
- Apex `xyz.com` redirects to `www.xyz.com`.
- Use a monorepo with separate deployable Next.js apps:
  - `apps/www` for marketing.
  - `apps/app` for the chat app.
- Include a shared UI/tokens package, while keeping app-specific components inside each app.
- Marketing site starts with accurate polished previews and swaps to real screenshots before public launch.
- Marketing should mention camera sharing carefully: consent-based, camera-only, view-once, and without promising screenshot prevention.
- Marketing MVP includes a concise homepage plus Terms, Privacy, Community Guidelines, Safety, and Contact/Support pages.
- Development legal pages can use placeholders, but lawyer-reviewed legal/safety pages are required before public launch.
- Terms/Privacy acceptance happens in the app before chatting; the marketing site only links legal pages.

## Users And Identity

- Support two user modes:
  - Guests.
  - Google-authenticated users.
- First screen of the app prioritizes instant guest chat.
- Google login is an upgrade path, not a gate.
- Google auth only for MVP.
- Any Google account can log in as a user.
- Admin access is restricted separately by role/allowlist.
- Google login is private account infrastructure; no real Google identity is exposed publicly.
- Both guests and logged-in users receive a random display name and avatar.
- Display names and avatars are visible to the matched stranger.
- Display usernames are not globally unique.
- Guest identity is session-scoped.
- Logged-in identity persists across sessions.
- Username changes are limited to once per day.
- Avatar changes are limited to once per day.
- Avatar changes must use a built-in/generated avatar set only.
- No uploaded profile images.
- Username changes are moderated before saving.
- Block slurs, sexual terms, contact info, URLs, social handles, and reserved platform terms in usernames.
- Guests are automatically assigned a random name/avatar before chat.
- Guests can optionally change username/avatar later, subject to limits and moderation.
- Username/avatar change limits apply to logged-in accounts and guest sessions, with best-effort guest device/session rate limiting.
- No explicit guest identity reset button in MVP.

## Age, Consent, And Legal

- MVP is 18+ only.
- Both guests and logged-in users must explicitly confirm they are 18+ before chatting.
- Age confirmation is combined with Terms/Privacy acceptance in one concise gate.
- Record accepted legal version and timestamp:
  - For logged-in users, persist with the account.
  - For guests, persist with the session.
- Show concise safety guidelines before first chat.
- Persist safety guideline acceptance.
- Reshow guidelines when the guideline version changes or after enforcement events.
- Include minimal region-aware cookie/privacy consent.
- Separate essential cookies from analytics.
- Essential safety/operational events may run before consent.
- Product analytics respects regional consent requirements.

## Guest Vs Logged-In Capabilities

- Guests can instantly start text chatting.
- Guests have limited features.
- Logged-in users receive premium-style launch entitlements for free.
- Media sharing is restricted to Google-authenticated users only.
- Both matched users must be logged in before camera sharing can be enabled.
- Gender filters are available to logged-in users.
- Guests have no gender filter controls.
- Logged-in benefits are filters, media eligibility, persistent preferences, and identity continuity.
- No logged-in queue priority in MVP.
- Use per-feature entitlement flags, such as:
  - `gender_filter`
  - `camera_media`
  - Future premium features
- No payments/subscriptions in MVP.

## Matching

- Use one shared matching pool for guests and logged-in users.
- Media eligibility is handled after a match, not as a separate matchmaking pool.
- Default matching is global.
- No public region filter in MVP.
- Language is a lightweight matching signal.
- UI language and matching language are separate preferences.
- Both default from browser language.
- Logged-in onboarding requires/sets language quickly.
- Logged-in users are prompted for gender with `Male`, `Female`, or `Prefer not to say`.
- Profile gender options:
  - `Male`
  - `Female`
  - `Prefer not to say`
- Gender filter options:
  - `Male`
  - `Female`
  - `Both`
- Gender-filtered logged-in users can be matched with guests.
- Gender filters are a strong preference, not a guarantee.
- For filtered matching, first try declared logged-in users of the selected gender, then fall back to guests after a visible wait window.
- UI copy should quietly explain that filters guide matching when available.
- Logged-in users cannot opt out of guest matches in MVP.
- Use staged matching:
  - Respect hard constraints where applicable.
  - Prefer language initially.
  - Relax soft constraints to keep wait times low.
- No interest-based matching in MVP.
- No public live online count in MVP.
- Keep internal queue health metrics.
- Stranger remains anonymous beyond generated display name/avatar.
- Do not show real profile details, gender, language, email, or Google identity.

## Chat Experience

- Text chat is one-to-one and real time.
- Include typing indicators.
- Typing indicators use the stranger's generated display name.
- No text read receipts in MVP.
- Text messages have minimal failed-send/retry states while the match remains valid.
- If a Socket.IO ack fails or disconnect occurs, show failed state and allow retry.
- If the match ended, unsent messages are not delivered.
- No clickable links in MVP.
- URL-like text may be allowed as plain text but should be flagged/rate-limited.
- Text chat history disappears when the match ends.
- No user-facing reconnect/history feature in MVP.
- Allow a short reconnect grace window, around 20-30 seconds, for the same browser session.
- Clicking `Next`, reporting, blocking, or timeout permanently closes the match.
- `Next` uses a two-step control:
  - First click changes button to `Confirm`.
  - Second click disconnects and queues the user again.
  - `Confirm` state lasts 3 seconds, then reverts.
- Reporting/blocking immediately ends the current match.
- Reporting/blocking expires media, prevents immediate rematch, and returns the reporting user to a safe state.
- `Block` and `Report` are separate actions.
- Reporting includes an "Also block this user" option checked by default.

## Media Sharing

- Media is ephemeral and not stored.
- Use WebRTC data channels for browser-to-browser media transfer.
- Use Socket.IO only for WebRTC signaling and permission events.
- Use Cloudflare for WebRTC traversal/media infrastructure.
- Use public STUN plus managed TURN from day one.
- Build with WebRTC first and no storage.
- Temporary relay is deferred and should only be considered later if metrics show too many failed transfers.
- Media is restricted to logged-in users only.
- Both users must be logged in and both must consent before media unlocks.
- Media consent is requested once per match.
- Either user can revoke media consent mid-chat.
- Revoking media disables new media sends and expires pending unopened media.
- Media sharing is camera-captured images only.
- Do not allow sharing from storage, gallery, or file picker.
- Use `getUserMedia` to open an in-app camera UI.
- Capture a frame inside the web app, show preview, then send after confirmation.
- Captured images are view-once by default.
- Receiver explicitly opens a media bubble, views for 8 seconds, then it disappears.
- Sender sees only:
  - `Sent`
  - `Opened`
  - `Expired`
- Unviewed media expires when:
  - The match ends.
  - Either user disconnects.
  - Either user clicks `Next`.
  - Media consent is revoked.
- Media expires immediately on disconnect, even during the text reconnect grace window.
- One pending media item per sender per match.
- Camera images are resized/compressed client-side before transfer.
- Strip EXIF/location metadata.
- Camera opens front-facing by default.
- Include a camera switch control when available.
- Camera UI includes a concise safety reminder that view-once does not prevent screenshots.
- No screenshot detection promise in MVP.
- Keep architecture hooks for future screenshot-related events if feasible.
- Server never sees image bytes.
- WebRTC media transport provides encryption in transit.
- App server handles only permission, signaling, events, and metadata.

## Moderation And Safety

- Use automated checks plus human moderation from day one.
- Start with deterministic/rule-based moderation plus human review.
- Defer AI moderation.
- Abuse filtering targets:
  - Slurs.
  - Threats.
  - Harassment.
  - Spam.
  - Underage signals.
  - Illegal/unsafe/non-consensual/harassing sexual patterns.
- Do not automatically block ordinary profanity.
- Do not blanket-ban adult sexual text.
- Block/escalate illegal, unsafe, non-consensual, exploitative, harassing, and underage-related sexual content.
- Lower-severity blocked messages warn/rate-limit.
- High-severity or repeated blocked messages can auto-end the chat and escalate.
- Guests and logged-in users can report and block.
- Guest reports count, but logged-in reports may carry more trust weight.
- Report categories:
  - Harassment/hate.
  - Sexual content.
  - Underage concern.
  - Spam/scam.
  - Media abuse.
  - Self-harm/threats.
  - Other.
- Category-only reports are allowed.
- Free-text details are optional.
- Reports include surrounding eligible text context when available.
- Media abuse reports capture metadata only, not image bytes.
- Media report metadata includes sender, receiver, match ID, timestamps, request/accept events, sent/opened/expired status, and surrounding eligible text context.
- Keep a short rolling encrypted/in-memory or Redis buffer during active chats.
- Persist relevant report context only when a report is filed.
- If nobody reports, the buffer expires automatically.
- Moderation supports warnings, cooldowns, temporary bans, and permanent bans.
- Suggested escalation options include cooldown, 24 hours, 7 days, and permanent.
- Low-severity first offenses can receive warnings/cooldowns.
- Severe violations skip warnings.
- Banned users see restriction duration and broad reason category, not detailed evidence.
- Minimal appeal flow for logged-in users only.
- Google email is used internally for auth/admin/moderation needs.
- No product or marketing emails in MVP.

## Admin And Operations

- Include a minimal admin dashboard from day one.
- Admin dashboard supports:
  - Reviewing reports.
  - Seeing report context.
  - Issuing bans/restrictions.
  - Resolving cases.
  - Managing appeals.
  - Managing feature flags.
- Admin access uses Google login plus database roles.
- Initial admin assignment uses an allowlist.
- Admin actions are audit-logged.
- Operational alerts are required for:
  - Elevated report rate.
  - Queue backlog or match failures.
  - Backend error rate.
  - WebSocket disconnect spikes.
  - WebRTC connection failure spikes.
- Launch moderation/alert owner is the founder initially.
- Founder contact details and coverage windows are TBD and must be provided before launch.
- Include a simple public support/contact path.
- Support includes:
  - In-app flows where context matters.
  - Public support email for general/legal contact.
- Logged-in account deletion is self-serve with confirmation.
- Support handles edge cases.

## Abuse Controls And Rate Limits

- Use layered identity for abuse prevention:
  - Logged-in account ID.
  - Guest anonymous session ID.
  - Conservative IP/rate/device signals.
- Avoid invasive fingerprinting.
- Use adaptive bot protection, not always-on CAPTCHA.
- Cloudflare Turnstile or similar should trigger only on risk signals.
- Risk signals include rapid sessions, suspicious IPs, repeated reports, and automation-like behavior.
- Guests have stricter rate limits.
- Logged-in users have higher but still enforced thresholds.
- Rate limit queue/reconnect attempts for bot/load protection.
- Do not add a rapid-`Next` cooldown in MVP beyond the two-step confirmation.

## Data Retention And Privacy

- No user-facing chat history.
- Keep only minimal backend records needed for abuse prevention and operations.
- Text is not end-to-end encrypted in MVP.
- Use TLS in transit.
- Server can process text for moderation, rate limits, and report context.
- Custom event tracker is built in-house instead of using PostHog/Amplitude/etc.
- Analytics use pseudonymous internal IDs:
  - Guest session IDs.
  - Logged-in internal user IDs.
  - Never raw Google IDs/emails.
- Raw analytics retention is 90 days.
- Aggregated metrics may be retained longer.
- Moderation/report records have longer retention, roughly 1-2 years.
- Logged-in users get account deletion.
- Account deletion wipes profile/preferences and display labels.
- Moderation records may be retained/anonymized/restricted where needed for safety/legal reasons.
- Guest data expires by session and retention policy.

## Analytics And Success Metrics

- Build product and safety analytics from day one.
- Track essential events:
  - Age gate accepted.
  - Guest started.
  - Login started/completed.
  - Queue joined/left.
  - Match created.
  - Match ended and reason.
  - Message sent/blocked.
  - Report submitted.
  - Block submitted.
  - Media requested/accepted/declined.
  - Media sent/opened/expired.
  - WebRTC connection success/failure.
  - Username/avatar changed.
  - Ban issued.
- Primary MVP health metrics:
  - Time to first successful match.
  - Report/safety rates.
- Other important metrics:
  - Match success rate.
  - Average chat duration.
  - Next rate.
  - Block rate.
  - Login conversion.
  - Media consent acceptance rate.
  - WebRTC connection success rate.
  - Media opened/expired rate.
  - Moderation action rate.

## Frontend UX

- Mobile-first layout with polished desktop adaptation.
- Mobile chat is full-screen.
- Mobile layout includes:
  - Top bar with stranger avatar/name and safety actions.
  - Message stream in the middle.
  - Bottom composer.
- Camera affordance is visible but locked/disabled when unavailable.
- Locked camera affordance shows concise reason.
- Unlock camera only when both users are logged in and consented.
- Use subtle in-app sounds for match found, new message, and media request.
- Include a mute toggle.
- No push notifications in MVP.
- Dark mode is default.
- Use token-based styling.
- Include light mode toggle only if low-cost.
- Build i18n infrastructure.
- Ship English UI first.
- Baseline accessibility is an explicit MVP requirement.
- Include keyboard navigation, focus states, screen-reader labels, color contrast, reduced-motion support, and accessible modals.
- Animations respect `prefers-reduced-motion`.

## Architecture And Stack

- Use separate deployables for frontend and realtime/API service.
- Frontend stack:
  - Next.js.
  - React.
  - Tailwind CSS.
- Backend stack:
  - NestJS.
  - Socket.IO.
- Database/cache:
  - PostgreSQL for users, reports, audit data, admin config, and durable records.
  - Redis for queues, sessions, rate limits, ephemeral buffers, and realtime state.
- Realtime:
  - Socket.IO for chat, matchmaking events, presence, typing indicators, WebRTC signaling, and reconnect behavior.
- Auth:
  - Auth.js/NextAuth handles Google login in Next.js.
  - NestJS receives/verifies an app session/JWT identity for Socket.IO/API.
  - Secure HTTP-only cookies for web auth.
  - Short-lived signed tokens for Socket.IO handshakes.
  - Guests receive signed anonymous session cookies after age/terms acceptance.
- Deployment:
  - Vercel for Next.js frontend apps.
  - Fly.io or Render for the NestJS realtime service.
  - Managed PostgreSQL.
  - Managed Redis.
  - Cloudflare for DNS/security/WebRTC TURN.
- Choose Fly.io vs Render later based on WebSocket reliability, regions, and operational preference.

## Open Items

- Final domain name is placeholder `xyz.com`; real domain TBD.
- Founder moderation/alert contact details and coverage windows TBD.
- Exact Cloudflare WebRTC/TURN product and pricing must be verified before implementation.
- Fly.io vs Render backend hosting decision remains open.
- Legal counsel must review Terms, Privacy, Safety, and Community Guidelines before public launch.
