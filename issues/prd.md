## Problem Statement

Users want a fast, modern stranger chat experience that lets them talk to random people instantly without the friction and dated feel of existing products. The current competitive benchmark has basic real-time chat and media sharing, but the media flow feels awkward for a web product, the UX lacks polish, and safety/moderation foundations are not strong enough for a public launch.

The MVP must support anonymous one-to-one text chat for live public users while protecting the product from obvious abuse. It must balance low-friction guest access with stronger logged-in capabilities, including gender filters and consent-based ephemeral camera media. Because the product launches publicly from day one, authentication, reporting, blocking, moderation tooling, rate limits, feature flags, analytics, legal acceptance, and operational monitoring are core MVP requirements rather than future hardening.

## Solution

Build a production-ready web MVP for anonymous one-to-one stranger text chat. Users can enter as guests or sign in with Google. Guests can start chatting quickly after confirming they are 18+ and accepting the current legal/safety terms. Logged-in users get launch entitlements for gender filters, persistent identity/preferences, and camera-only media sharing when both matched users are logged in and both consent.

The product will use a public marketing site and a separate chat app. The app will provide real-time random matching, text chat, typing indicators, a two-step Next flow, reporting, blocking, moderated generated usernames/avatars, lightweight language matching, and safety-first admin operations. Ephemeral media will use camera capture inside the browser, WebRTC data channels for peer-to-peer transfer, no server-side image storage, view-once behavior, and explicit consent/revocation per match.

The backend will provide realtime matching, Socket.IO chat/signaling, moderation, abuse controls, durable safety records, ephemeral Redis state, feature flags, product analytics, admin review tools, and operational alerts. The MVP intentionally defers voice, video, payments, mobile apps, subscriptions, interest matching, AI moderation, and long-lived chat history.

## User Stories

1. As a first-time visitor, I want to understand the product from the marketing homepage, so that I can decide whether to try anonymous stranger chat.
2. As a first-time visitor, I want the marketing site to explain safety and media behavior accurately, so that I understand the limits before using the app.
3. As a first-time visitor, I want to access Terms, Privacy, Community Guidelines, Safety, and Contact pages, so that I can review the rules and support options.
4. As a user landing on the app, I want guest chat to be the most obvious starting path, so that I can start quickly.
5. As a user, I want to sign in with Google as an optional upgrade path, so that I can unlock more features without being forced to create a separate account.
6. As a guest, I want to confirm that I am 18+ and accept the current Terms and Privacy policy before chatting, so that I can use the service under the required rules.
7. As a logged-in user, I want my legal acceptance to persist with my account, so that I do not repeatedly accept the same version.
8. As a guest, I want my legal acceptance to persist for my session, so that I can continue using the app during the same visit.
9. As a user, I want to see concise safety guidelines before my first chat, so that I know the expected behavior.
10. As a user, I want updated safety guidelines to be shown again when the version changes, so that I understand new rules.
11. As a user, I want safety guidelines to be shown again after enforcement events, so that I understand why the product is warning me.
12. As a privacy-conscious user, I want cookie/privacy consent to separate essential safety operations from analytics, so that I understand what is necessary and what is optional.
13. As a guest, I want a random display name and avatar assigned automatically, so that I can chat anonymously without setup.
14. As a logged-in user, I want a random display name and avatar instead of my Google identity, so that my real identity remains private.
15. As a matched user, I want to see the stranger's generated name and avatar, so that the chat feels personal without exposing real profile details.
16. As a user, I want to change my generated username once per day, so that I can personalize my identity without enabling abuse.
17. As a user, I want username changes to be moderated before saving, so that offensive names do not enter chats.
18. As a user, I want usernames to block slurs, sexual terms, contact info, URLs, social handles, and reserved platform terms, so that display names stay safe.
19. As a user, I want to change my avatar once per day from a built-in/generated set, so that I can personalize my profile safely.
20. As a safety operator, I want profile image uploads excluded from MVP, so that image abuse and moderation scope stay contained.
21. As a guest, I want optional profile edits to respect the same limits as logged-in users, so that guests cannot bypass identity controls.
22. As a logged-in user, I want my generated identity and preferences to persist across sessions, so that the app feels continuous.
23. As a guest, I want my identity to remain session-scoped, so that guest access stays lightweight.
24. As a user, I want to join a shared matching pool, so that there are enough people available for fast matches.
25. As a user, I want default matching to be global, so that wait times stay low.
26. As a user, I want my browser language to seed my matching language, so that I am more likely to meet someone I can talk to.
27. As a user, I want UI language and matching language to be separate preferences, so that interface localization and match preference can evolve independently.
28. As a logged-in user, I want onboarding to ask for my matching language quickly, so that matching can use the right signal.
29. As a logged-in user, I want to set my gender as Male, Female, or Prefer not to say, so that gender filters can work without forcing more disclosure.
30. As a logged-in user, I want to choose a gender filter of Male, Female, or Both, so that I can guide matching toward my preference.
31. As a logged-in user, I want gender filters to be a strong preference rather than a promise, so that the app can still find matches when inventory is limited.
32. As a logged-in user with a gender filter, I want the app to first search for declared logged-in users matching my filter, so that my preference is respected when possible.
33. As a logged-in user with a gender filter, I want the app to fall back to guests after a visible wait window, so that I am not stuck indefinitely.
34. As a logged-in user, I want clear copy that filters guide matching when available, so that expectations are honest.
35. As a logged-in user, I want to understand that I may still match with guests, so that I know the MVP limitations.
36. As a user, I want the app to prefer language initially and relax soft constraints over time, so that matching feels relevant but fast.
37. As a user, I want to avoid seeing public online counts, so that the app does not create misleading expectations.
38. As an operator, I want internal queue health metrics, so that I can detect matching problems.
39. As a user, I want one-to-one real-time text chat, so that the core experience feels immediate.
40. As a user, I want typing indicators with the stranger's generated display name, so that I can tell when they are responding.
41. As a user, I do not want text read receipts, so that the chat stays low-pressure in MVP.
42. As a sender, I want failed messages to show a retry state while the match is still valid, so that temporary delivery issues are recoverable.
43. As a sender, I want unsent messages to stop retrying after the match ends, so that messages are not delivered out of context.
44. As a user, I want URL-like text to remain plain text rather than clickable links, so that phishing and outbound risk are reduced.
45. As a safety system, I want URL-like text to be flagged or rate-limited, so that spam patterns can be controlled.
46. As a user, I want chat history to disappear when the match ends, so that the product remains ephemeral.
47. As a user, I want a short reconnect grace window for the same browser session, so that brief network interruptions do not immediately kill a chat.
48. As a user, I want media to expire immediately on disconnect even during text reconnect grace, so that sensitive media remains tightly controlled.
49. As a user, I want clicking Next to require confirmation, so that I do not accidentally end a chat.
50. As a user, I want the Confirm state to expire after a few seconds, so that accidental first clicks are reversible.
51. As a user, I want clicking Next after confirmation to permanently close the match and requeue me, so that I can move on cleanly.
52. As a user, I want reporting to immediately end the current match, so that I can leave unsafe interactions.
53. As a user, I want blocking to immediately end the current match, so that I can avoid repeat contact.
54. As a user, I want reporting and blocking to prevent immediate rematch, so that I do not encounter the same person right away.
55. As a reporter, I want Report and Block to be separate actions, so that I can choose the right safety response.
56. As a reporter, I want an "also block this user" option checked by default, so that reporting usually protects me from rematching.
57. As a guest, I want to report unsafe behavior, so that safety tools are available without login.
58. As a logged-in user, I want to report unsafe behavior, so that moderators can act on abuse.
59. As a reporter, I want report categories for harassment/hate, sexual content, underage concern, spam/scam, media abuse, self-harm/threats, and other, so that I can classify incidents quickly.
60. As a reporter, I want category-only reports to be accepted, so that I can report even when I do not want to write details.
61. As a reporter, I want optional free-text report details, so that I can add context when useful.
62. As a moderator, I want reports to include surrounding eligible text context when available, so that I can evaluate incidents.
63. As a privacy-conscious user, I want report context to persist only when a report is filed, so that ordinary chats are not stored.
64. As an operator, I want an active-chat rolling buffer that expires automatically without reports, so that moderation has context without keeping unnecessary data.
65. As a moderator, I want guest reports to count but logged-in reports to carry more trust weight, so that review prioritization reflects identity confidence.
66. As a moderator, I want automated deterministic checks for slurs, threats, harassment, spam, underage signals, and unsafe sexual patterns, so that obvious abuse is caught early.
67. As a user, I do not want ordinary profanity automatically blocked, so that casual adult conversation is not over-moderated.
68. As a user, I do not want all adult sexual text blanket-banned, so that the moderation system focuses on illegal, unsafe, non-consensual, exploitative, harassing, or underage-related content.
69. As a user, I want lower-severity blocked messages to produce warnings or rate limits, so that mistakes can be corrected.
70. As a user, I want severe or repeated violations to auto-end chats and escalate, so that dangerous behavior is interrupted.
71. As a banned user, I want to see restriction duration and broad reason category, so that I know what happened without exposing detailed evidence.
72. As a logged-in banned user, I want a minimal appeal flow, so that I can challenge mistakes.
73. As a moderator, I want to issue warnings, cooldowns, 24-hour bans, 7-day bans, and permanent bans, so that enforcement can match severity.
74. As a moderator, I want severe violations to skip warnings, so that high-risk behavior receives immediate action.
75. As an admin, I want a minimal dashboard from day one, so that safety work can happen without database spelunking.
76. As an admin, I want to review reports and context, so that I can decide outcomes.
77. As an admin, I want to resolve cases, so that queues stay organized.
78. As an admin, I want to manage appeals, so that logged-in users have a basic review path.
79. As an admin, I want to issue bans and restrictions, so that I can enforce rules.
80. As an admin, I want to manage feature flags, so that risky product surfaces can be disabled quickly.
81. As an admin, I want admin actions audit-logged, so that moderation and configuration changes are accountable.
82. As an operator, I want admin access to require Google login plus database roles, so that general Google users cannot access tools.
83. As an operator, I want initial admins assigned through an allowlist, so that launch access can be controlled.
84. As an operator, I want feature flags for camera media, gender filters, guest access, and queue entry, so that launch risks can be managed.
85. As an operator, I want product safety/admin feature flags stored in database settings with caching and audit logs, so that changes are durable and traceable.
86. As an operator, I want alerts for elevated report rate, so that safety spikes are noticed quickly.
87. As an operator, I want alerts for queue backlog or match failures, so that the core experience can be restored quickly.
88. As an operator, I want alerts for backend error rate, so that service failures do not go unnoticed.
89. As an operator, I want alerts for WebSocket disconnect spikes, so that realtime reliability is monitored.
90. As an operator, I want alerts for WebRTC connection failure spikes, so that media infrastructure issues are visible.
91. As a user, I want a simple public support/contact path, so that I can reach the team for general or legal issues.
92. As a user, I want in-app support flows where context matters, so that reports and account issues can include relevant state.
93. As a logged-in user, I want self-serve account deletion with confirmation, so that I can remove my profile and preferences.
94. As a logged-in user deleting my account, I want profile preferences and display labels wiped, so that my account data is removed.
95. As a safety operator, I want moderation records retained, anonymized, or restricted when needed for safety/legal reasons, so that abuse prevention survives account deletion appropriately.
96. As a guest, I want my data to expire by session and retention policy, so that guest use remains lightweight.
97. As a logged-in user, I want media sharing to be available only when both matched users are logged in, so that media has stronger accountability.
98. As a logged-in user, I want both users to consent before media unlocks, so that camera sharing is mutual.
99. As a user, I want media consent to be requested once per match, so that consent is contextual.
100. As a user, I want to revoke media consent mid-chat, so that I can stop media sharing at any time.
101. As a user, I want revoking media consent to disable new sends and expire pending unopened media, so that consent withdrawal has immediate effect.
102. As a sender, I want to capture images only from my camera inside the web app, so that media is current and not uploaded from storage.
103. As a safety operator, I want gallery/file picker sharing excluded, so that MVP media abuse surface is smaller.
104. As a sender, I want the camera UI to open front-facing by default, so that quick selfies are easy.
105. As a sender, I want a camera switch control when available, so that I can choose another device camera.
106. As a sender, I want to preview a captured frame before sending, so that I can confirm what I am sharing.
107. As a sender, I want captured images resized and compressed client-side, so that sending is fast.
108. As a sender, I want EXIF/location metadata stripped, so that sensitive metadata is not shared.
109. As a sender, I want only one pending media item per sender per match, so that the view-once experience stays manageable.
110. As a receiver, I want to explicitly open a media bubble, so that I control when I view it.
111. As a receiver, I want opened media to disappear after 8 seconds, so that view-once behavior is clear.
112. As a sender, I want media status to show Sent, Opened, or Expired, so that I understand what happened without seeing receiver details.
113. As a user, I want unviewed media to expire when the match ends, either user disconnects, either user clicks Next, or media consent is revoked, so that media does not linger.
114. As a user, I want a concise reminder that view-once does not prevent screenshots, so that expectations are honest.
115. As an operator, I want no screenshot detection promise in MVP, so that the product avoids a misleading safety claim.
116. As an engineer, I want architecture hooks for future screenshot-related events where feasible, so that later capabilities are easier to add.
117. As a privacy-conscious user, I want the app server to never see image bytes, so that private camera media is not centrally stored.
118. As an engineer, I want Socket.IO to handle WebRTC signaling and permission events only, so that media bytes move over WebRTC data channels.
119. As an engineer, I want public STUN plus managed TURN from day one, so that WebRTC transfers work across common networks.
120. As an operator, I want temporary relay deferred unless metrics show too many failed transfers, so that infrastructure stays focused.
121. As a user, I want subtle sounds for match found, new message, and media request, so that realtime events are noticeable.
122. As a user, I want a mute toggle, so that I can disable sounds.
123. As a mobile user, I want the chat interface to be full-screen with a top bar, message stream, and bottom composer, so that the experience feels native to my device.
124. As a desktop user, I want the chat interface to adapt cleanly to larger screens, so that it remains polished outside mobile.
125. As a user, I want the camera affordance visible but locked when unavailable, so that I understand the feature exists.
126. As a user, I want locked camera affordances to explain why they are unavailable, so that I know whether login or consent is needed.
127. As a user, I want dark mode by default, so that the product fits chat usage expectations.
128. As a user, I want a light mode toggle if it is low-cost, so that I can choose a brighter interface.
129. As a user with accessibility needs, I want keyboard navigation, visible focus states, screen-reader labels, color contrast, accessible modals, and reduced-motion support, so that I can use the product.
130. As a user, I want animations to respect reduced-motion preferences, so that motion does not cause discomfort.
131. As an internationalization-minded operator, I want i18n infrastructure with English shipped first, so that localization can be added later without rework.
132. As a product operator, I want custom in-house event tracking, so that product and safety analytics exist without introducing a third-party analytics platform.
133. As a privacy-conscious user, I want analytics to use pseudonymous internal IDs rather than raw Google IDs or emails, so that analytics do not expose real identity.
134. As an operator, I want raw analytics retained for 90 days, so that recent product health can be analyzed.
135. As an operator, I want aggregated metrics retained longer, so that trends can be evaluated over time.
136. As a moderator, I want moderation and report records retained for roughly 1-2 years, so that safety investigations and repeat abuse handling are possible.
137. As a product lead, I want to track age gate acceptance, guest starts, login starts/completions, queue joins/leaves, matches, match end reasons, message sent/blocked events, reports, blocks, media consent events, media lifecycle events, WebRTC success/failure, username/avatar changes, and bans, so that MVP health is measurable.
138. As a product lead, I want time to first successful match and report/safety rates as primary MVP health metrics, so that launch decisions focus on speed and safety.
139. As a product lead, I want to monitor match success, average chat duration, Next rate, block rate, login conversion, media consent acceptance, WebRTC success, media opened/expired rates, and moderation action rate, so that product quality can improve after launch.
140. As an abuse prevention system, I want layered identity signals from logged-in account ID, guest session ID, conservative IP/rate/device signals, and report history, so that abuse can be limited without invasive fingerprinting.
141. As a user, I want adaptive bot protection only on risk signals, so that ordinary users are not interrupted by constant CAPTCHA.
142. As an operator, I want guests to have stricter rate limits than logged-in users, so that anonymous abuse is contained.
143. As an operator, I want logged-in users to retain enforced thresholds, so that login does not become an abuse bypass.
144. As an operator, I want queue and reconnect attempts rate-limited, so that bots cannot overload matching.
145. As a user, I do not want a rapid-Next cooldown beyond two-step confirmation, so that the product remains fluid.

## Implementation Decisions

- Build a production MVP, not a throwaway demo.
- Use a monorepo with separate deployable web applications for the marketing site and chat app.
- Serve the marketing site from the `www` subdomain, the chat app from the `app` subdomain, and redirect the apex domain to the marketing site.
- Include a shared UI/tokens package while keeping app-specific components within each app.
- Build the frontend with Next.js, React, and Tailwind CSS.
- Build the backend realtime/API service with NestJS and Socket.IO.
- Use PostgreSQL for durable user, report, audit, admin configuration, analytics, and moderation records.
- Use Redis for matchmaking queues, sessions, rate limits, ephemeral buffers, and realtime state.
- Use Auth.js/NextAuth for Google login in the Next.js app.
- Have the backend receive and verify an app session/JWT identity for Socket.IO and API access.
- Use secure HTTP-only cookies for web auth.
- Use short-lived signed tokens for Socket.IO handshakes.
- Issue signed anonymous session cookies to guests after legal/age acceptance.
- Restrict admin access using Google login plus database roles, seeded initially by allowlist.
- Use database-backed feature flags/kill switches for camera media, gender filters, guest access, and queue entry.
- Cache feature flag reads and audit all feature flag/admin changes.
- Model identity around guest sessions and logged-in internal user IDs, never public Google identity.
- Generate display names and avatars for all users.
- Keep display names non-unique and anonymous.
- Enforce once-per-day username and avatar changes for logged-in accounts and guest sessions, with best-effort guest session/device rate limiting.
- Limit avatars to built-in or generated avatar sets.
- Moderate usernames before saving and reject unsafe or reserved patterns.
- Implement a legal/safety acceptance gate before queue entry, combining 18+ confirmation with Terms/Privacy acceptance.
- Persist legal and safety acceptance version/timestamp to the logged-in account or guest session.
- Implement minimal region-aware cookie/privacy consent with analytics separated from essential safety/operational events.
- Use one shared matching pool for guests and logged-in users.
- Treat media eligibility as a post-match capability rather than a separate matchmaking pool.
- Use staged matching that respects hard constraints, prefers language initially, and relaxes soft constraints to preserve low wait times.
- Keep default matching global and omit public region filters from MVP.
- Keep UI language and matching language as separate preferences, both initially defaulted from browser language.
- Prompt logged-in users for language and gender during lightweight onboarding.
- Make gender filters available only to logged-in users and treat them as strong preferences, not guarantees.
- For gender-filtered matching, first try declared logged-in users of the selected gender, then fall back to guests after a visible wait window.
- Do not allow logged-in users to opt out of guest matches in MVP.
- Build one-to-one realtime text chat with typing indicators and minimal failed-send/retry handling.
- Do not implement read receipts or user-facing chat history.
- Allow a 20-30 second reconnect grace window for text chat in the same browser session.
- Permanently close a match on confirmed Next, reporting, blocking, or timeout.
- Implement Next as a two-step control with a temporary Confirm state.
- Implement Report and Block as separate controls, with reporting defaulting to also block.
- Prevent immediate rematch after report/block.
- Use deterministic/rule-based moderation plus human review from day one.
- Defer AI moderation.
- Moderate for slurs, threats, harassment, spam, underage signals, and illegal/unsafe/non-consensual/exploitative/harassing sexual patterns.
- Avoid automatically blocking ordinary profanity or blanket-banning adult sexual text.
- Use warnings, cooldowns, temporary bans, and permanent bans as enforcement actions.
- Offer a minimal appeal flow for logged-in users only.
- Keep a short rolling encrypted/in-memory or Redis buffer during active chats.
- Persist eligible text context only when a report is filed; expire buffers automatically otherwise.
- For media abuse reports, store metadata and surrounding eligible text context but never image bytes.
- Restrict media sharing to Google-authenticated users where both matched users are logged in and both consent.
- Request media consent once per match and allow either user to revoke it mid-chat.
- Expire pending unopened media when consent is revoked, the match ends, either user disconnects, or either user clicks Next.
- Use camera-only media captured through `getUserMedia` in an in-app camera UI.
- Exclude file picker, gallery, and uploaded profile images from MVP.
- Resize/compress camera images client-side and strip EXIF/location metadata before transfer.
- Send camera media over WebRTC data channels; use Socket.IO only for signaling, permission events, and metadata.
- Use Cloudflare-managed WebRTC traversal/media infrastructure with public STUN and managed TURN from day one.
- Defer temporary relay unless metrics show WebRTC failure rates are too high.
- Make view-once media open explicitly, viewable for 8 seconds, and then disappear.
- Limit each sender to one pending media item per match.
- Show only Sent, Opened, and Expired media states to the sender.
- Include honest camera safety copy that view-once does not prevent screenshots.
- Keep architecture hooks for future screenshot-related events where feasible, without promising screenshot detection in MVP.
- Build a minimal admin dashboard for reports, context review, bans/restrictions, appeals, feature flags, and case resolution.
- Build an in-house event tracker for product and safety analytics.
- Use pseudonymous analytics IDs rather than raw Google identifiers or emails.
- Retain raw analytics for 90 days, aggregated metrics longer, and moderation/report records for roughly 1-2 years.
- Implement self-serve logged-in account deletion with confirmation, wiping profile/preferences/display labels while retaining/anonymizing/restricting moderation records where required.
- Use layered abuse controls: account ID, guest session ID, conservative IP/rate/device signals, report history, rate limits, and adaptive bot protection.
- Trigger Cloudflare Turnstile or similar only on risk signals such as rapid sessions, suspicious IPs, repeated reports, or automation-like behavior.
- Use stricter thresholds for guests and higher but enforced thresholds for logged-in users.
- Include operational alerts for report spikes, queue backlog, match failures, backend errors, WebSocket disconnect spikes, and WebRTC failure spikes.
- Deploy Next.js apps on Vercel.
- Deploy the NestJS realtime service on either Fly.io or Render after comparing WebSocket reliability, regions, and operational preference.
- Use managed PostgreSQL, managed Redis, Cloudflare DNS/security, and Cloudflare WebRTC/TURN infrastructure.
- Keep the final domain, founder moderation contact details, alert coverage windows, exact Cloudflare WebRTC/TURN product/pricing, and backend host choice open until verified.
- Require lawyer-reviewed Terms, Privacy, Safety, and Community Guidelines before public launch.

## Testing Decisions

- Good tests should verify externally observable behavior and contracts rather than implementation details.
- Test matchmaking around queue entry, staged language preference, gender-filter preference/fallback, guest/logged-in shared pool behavior, match creation, match ending, and immediate-rematch prevention.
- Test identity and onboarding around guest session creation, Google user persistence, generated display labels, legal/safety acceptance versions, username/avatar rate limits, and username moderation rejection.
- Test chat realtime behavior around message delivery acknowledgements, failed-send retry, match-ended delivery prevention, typing indicators, reconnect grace, timeout handling, and two-step Next behavior.
- Test reporting/blocking around category-only reports, optional details, default also-block behavior, match termination, media expiration, context capture, case creation, and trust weighting inputs.
- Test moderation rule behavior around blocked terms, warnings, rate limits, high-severity auto-ending, repeated-offense escalation, and non-blocking ordinary profanity cases.
- Test media permissions around logged-in-only eligibility, both-user consent, consent revocation, one-pending-item limits, media status transitions, expiration triggers, and no server-side image byte handling.
- Test WebRTC signaling contracts around offer/answer/ICE relay through Socket.IO, permission event sequencing, connection success/failure events, and metrics emission.
- Test admin behavior around role checks, allowlist seeding, report review, enforcement actions, appeal handling, feature flag changes, and audit logging.
- Test feature flag behavior around cached reads, database state changes, audit logs, and kill switches for camera media, gender filters, guest access, and queue entry.
- Test abuse controls around guest/logged-in rate limits, queue/reconnect throttles, adaptive bot protection triggers, and ban/cooldown enforcement.
- Test analytics around required event emission, pseudonymous identifiers, consent-sensitive analytics behavior, raw retention boundaries, and primary MVP health metric derivation.
- Test account deletion around confirmation, profile/preference/display-label deletion, and moderation record retention/anonymization behavior.
- Test legal/privacy behavior around region-aware consent, essential event allowance before consent, analytics opt-in requirements, and version re-acceptance.
- Test accessibility through keyboard navigation, focus management, screen-reader labels, modal behavior, color contrast, and reduced-motion behavior.
- Test frontend responsive behavior on mobile and desktop, especially the full-screen mobile chat layout, composer, top bar safety actions, locked camera affordance, camera preview, view-once media display, and text overflow.
- Test operational alerting by simulating elevated report rates, queue backlog, match failures, backend errors, WebSocket disconnect spikes, and WebRTC failure spikes.
- Prior art in this codebase is limited to the brief and decision log; implementation should establish the first test patterns for unit tests, integration tests, realtime contract tests, and end-to-end browser tests.
- Deep modules that should be isolated for testing include matchmaking, entitlement/feature flag evaluation, legal acceptance, display identity moderation, moderation rule evaluation, report context capture, media lifecycle state, rate limiting, analytics event normalization, and admin enforcement workflows.

## Out of Scope

- Voice chat.
- Video chat.
- AI-powered matchmaking.
- AI moderation.
- Interest-based matching.
- Public region filters.
- Public live online counts.
- Logged-in queue priority.
- Logged-in users opting out of guest matches.
- Subscriptions, payments, or paid premium features.
- Mobile apps for iOS or Android.
- Push notifications.
- Creator/community systems.
- Gamification and streaks.
- Product or marketing email campaigns.
- User-facing chat reconnect history.
- Text read receipts.
- Uploaded profile images.
- Gallery, storage, or file-picker media sharing.
- Server-side storage of media image bytes.
- Screenshot detection promises.
- Temporary media relay infrastructure unless future metrics require it.
- Invite-only/private beta launch.
- A full legal review inside engineering scope; legal counsel must review public legal/safety pages before launch.

## Further Notes

- The final public domain is still represented as `xyz.com` and must be replaced before launch.
- Founder moderation/alert contact details and coverage windows are required before launch.
- The exact Cloudflare WebRTC/TURN product and pricing must be verified before implementation.
- The backend hosting decision between Fly.io and Render remains open.
- Development legal pages may use placeholders, but public launch requires lawyer-reviewed Terms, Privacy, Safety, and Community Guidelines.
- Marketing previews can start as polished accurate mockups but should be replaced with real screenshots before public launch.
- Marketing copy must describe camera sharing as consent-based, camera-only, and view-once without implying screenshot prevention.
- Google email may be used internally for authentication, admin, and moderation operations, but it must never be shown publicly to matched strangers.
- Media transport encryption comes from WebRTC in transit; text chat is not end-to-end encrypted in MVP and is processed server-side for moderation, rate limits, and report context.
