#!/usr/bin/env node
import { execFileSync } from "node:child_process";

const repo = "prathmesh-mhatre/fahhhchat";
const parentPrd = "None - source PRD is local file `issues/prd.md`.";

const issues = [
  { title: "Monorepo And App Skeletons", type: "AFK", blockedBy: [], stories: [123, 124, 127, 129, 131], build: "Create the production monorepo skeleton with separate deployable web app, marketing app, backend realtime/API service, shared package structure, dark mobile-first app shell, baseline i18n wiring, and first test commands." },
  { title: "Shared UI Tokens And Base Components", type: "AFK", blockedBy: ["Monorepo And App Skeletons"], stories: [123, 124, 127, 129, 130], build: "Create shared design tokens and accessible base UI primitives that both web apps can reuse while keeping app-specific chat and marketing components separate." },
  { title: "Marketing Homepage", type: "AFK", blockedBy: ["Monorepo And App Skeletons", "Shared UI Tokens And Base Components"], stories: [1, 2], build: "Build the public homepage explaining anonymous text chat, guest access, logged-in benefits, safety expectations, and consent-based camera-only view-once media without implying screenshot prevention." },
  { title: "Public Legal And Support Pages", type: "HITL", blockedBy: ["Marketing Homepage"], stories: [3, 91], build: "Add Terms, Privacy, Community Guidelines, Safety, and Contact/Support pages with launch placeholders clearly structured for legal and founder review." },
  { title: "Guest Session And Age/Legal Gate", type: "AFK", blockedBy: ["Monorepo And App Skeletons"], stories: [4, 6, 8], build: "Let a guest begin the chat flow only after confirming 18+ status and accepting the current Terms/Privacy version, then persist that acceptance for the browser session." },
  { title: "Safety Guidelines Gate And Version Re-Prompting", type: "AFK", blockedBy: ["Guest Session And Age/Legal Gate"], stories: [9, 10, 11], build: "Show concise safety guidelines before first chat, persist guideline version acceptance, and re-show guidelines when the version changes or after enforcement events." },
  { title: "Cookie And Analytics Consent", type: "AFK", blockedBy: ["Guest Session And Age/Legal Gate"], stories: [12], build: "Add minimal region-aware privacy consent that separates essential safety/operational behavior from optional analytics tracking." },
  { title: "Google Login And Persistent User Session", type: "AFK", blockedBy: ["Monorepo And App Skeletons"], stories: [5, 7, 133], build: "Add Google login as an optional upgrade path, persist logged-in legal acceptance, create internal user identifiers, and avoid exposing Google identity publicly." },
  { title: "Socket Auth For Guests And Logged-In Users", type: "AFK", blockedBy: ["Guest Session And Age/Legal Gate", "Google Login And Persistent User Session"], stories: [4, 5, 140], build: "Issue and verify the guest/app session identity needed for API and Socket.IO access, including short-lived signed tokens for realtime handshakes." },
  { title: "Generated Display Names And Avatars", type: "AFK", blockedBy: ["Guest Session And Age/Legal Gate", "Google Login And Persistent User Session"], stories: [13, 14, 15, 22, 23], build: "Automatically assign anonymous generated names and avatars to guests and logged-in users, show them to matched strangers, persist logged-in identity, and keep guest identity session-scoped." },
  { title: "Username Editing With Moderation Rules", type: "AFK", blockedBy: ["Generated Display Names And Avatars"], stories: [16, 17, 18, 21], build: "Allow once-daily username changes for guests and logged-in users while rejecting unsafe names that contain slurs, sexual terms, contact info, URLs, social handles, or reserved platform terms." },
  { title: "Avatar Editing From Safe Built-In Set", type: "AFK", blockedBy: ["Generated Display Names And Avatars"], stories: [19, 20, 21], build: "Allow once-daily avatar changes from a safe built-in/generated avatar set and exclude profile image uploads from the MVP." },
  { title: "Logged-In Onboarding For Language And Gender", type: "AFK", blockedBy: ["Google Login And Persistent User Session"], stories: [27, 28, 29], build: "Add lightweight logged-in onboarding for matching language and gender while keeping UI language and matching language as separate preferences." },
  { title: "Gender Filter Preferences And Honest UI Copy", type: "AFK", blockedBy: ["Logged-In Onboarding For Language And Gender"], stories: [30, 31, 34, 35], build: "Let logged-in users choose Male, Female, or Both as a gender filter and explain that filters guide matching when inventory allows, including possible guest matches." },
  { title: "Database-Backed Feature Flags", type: "AFK", blockedBy: ["Monorepo And App Skeletons"], stories: [80, 84, 85], build: "Implement database-backed feature flags and kill switches for camera media, gender filters, guest access, and queue entry." },
  { title: "Feature Flag Audit Logging And Cache Invalidation", type: "AFK", blockedBy: ["Database-Backed Feature Flags"], stories: [81, 85], build: "Cache feature flag reads, invalidate cache on changes, and audit feature flag/admin setting changes for accountability." },
  { title: "Basic Shared Matchmaking Queue", type: "AFK", blockedBy: ["Guest Session And Age/Legal Gate", "Google Login And Persistent User Session", "Socket Auth For Guests And Logged-In Users", "Database-Backed Feature Flags"], stories: [24, 25, 37, 38], build: "Build the Redis-backed shared global matching pool for guests and logged-in users, omit public online counts, and expose internal queue health metrics." },
  { title: "Language-Aware Matching Relaxation", type: "AFK", blockedBy: ["Logged-In Onboarding For Language And Gender", "Basic Shared Matchmaking Queue"], stories: [26, 36], build: "Use browser/default matching language as an initial preference and relax language matching over time to keep wait times low." },
  { title: "Gender Filter Matching Fallback", type: "AFK", blockedBy: ["Gender Filter Preferences And Honest UI Copy", "Basic Shared Matchmaking Queue"], stories: [31, 32, 33, 35], build: "For logged-in users with gender filters, first search declared logged-in users matching the filter, then visibly fall back to guests after the wait window." },
  { title: "Queue Rate Limits And Reconnect Throttles", type: "AFK", blockedBy: ["Basic Shared Matchmaking Queue"], stories: [140, 142, 143, 144, 145], build: "Apply queue and reconnect rate limits using layered identity signals, with stricter guest thresholds and enforced logged-in thresholds." },
  { title: "Realtime Text Message Delivery", type: "AFK", blockedBy: ["Socket Auth For Guests And Logged-In Users", "Basic Shared Matchmaking Queue"], stories: [39, 42, 43, 46], build: "Deliver one-to-one realtime text chat with server acknowledgement, ephemeral match-scoped history, and guardrails that prevent delivery after the match ends." },
  { title: "Typing Indicators And No-Read-Receipt Chat UX", type: "AFK", blockedBy: ["Realtime Text Message Delivery"], stories: [40, 41], build: "Add typing indicators that use the stranger's generated display name and intentionally exclude text read receipts from the MVP." },
  { title: "Failed Message Retry And Match-End Guarding", type: "AFK", blockedBy: ["Realtime Text Message Delivery"], stories: [42, 43], build: "Show failed message states with retry while the match remains valid and stop retries or delivery once the match has ended." },
  { title: "Plain-Text URL Handling And Spam Signals", type: "AFK", blockedBy: ["Realtime Text Message Delivery"], stories: [44, 45], build: "Render URL-like text as non-clickable plain text and flag or rate-limit URL-like message patterns for spam control." },
  { title: "Text Reconnect Grace Window", type: "AFK", blockedBy: ["Realtime Text Message Delivery"], stories: [47, 48], build: "Allow a short same-browser-session reconnect grace window for text chat while ensuring media expires immediately on disconnect." },
  { title: "Two-Step Next Flow", type: "AFK", blockedBy: ["Realtime Text Message Delivery"], stories: [49, 50, 51], build: "Implement Next as a two-step flow where the first click enters a temporary Confirm state and the second permanently closes the match and requeues the user." },
  { title: "Report And Block Match Termination", type: "AFK", blockedBy: ["Realtime Text Message Delivery", "Two-Step Next Flow"], stories: [52, 53, 54, 55, 56], build: "Implement separate Report and Block actions that immediately end the match, return the user to safety, prevent immediate rematch, and default reports to also block." },
  { title: "Report Form Categories And Optional Details", type: "AFK", blockedBy: ["Report And Block Match Termination"], stories: [57, 58, 59, 60, 61], build: "Add report categories for harassment/hate, sexual content, underage concern, spam/scam, media abuse, self-harm/threats, and other, accepting category-only reports with optional details." },
  { title: "Rolling Chat Context Buffer For Reports", type: "AFK", blockedBy: ["Realtime Text Message Delivery", "Report Form Categories And Optional Details"], stories: [62, 63, 64], build: "Maintain an expiring rolling active-chat context buffer and persist eligible surrounding text context only when a report is filed." },
  { title: "Report Trust Weighting And Case Creation", type: "AFK", blockedBy: ["Report Form Categories And Optional Details", "Rolling Chat Context Buffer For Reports"], stories: [65, 76, 77], build: "Create moderator cases from reports with guest reports counted and logged-in reports carrying higher trust weight for prioritization." },
  { title: "Moderation Rule Engine For Text And Usernames", type: "AFK", blockedBy: ["Username Editing With Moderation Rules", "Realtime Text Message Delivery"], stories: [66, 67, 68], build: "Implement deterministic moderation checks for slurs, threats, harassment, spam, underage signals, and unsafe sexual patterns while avoiding blanket blocks for ordinary profanity or adult text." },
  { title: "Warnings, Rate Limits, And Auto-End Escalation", type: "AFK", blockedBy: ["Moderation Rule Engine For Text And Usernames"], stories: [69, 70, 73, 74], build: "Convert moderation outcomes into warnings, rate limits, cooldowns, temporary bans, permanent bans, and high-severity auto-ending behavior." },
  { title: "Restriction UX And Logged-In Appeal Entry", type: "AFK", blockedBy: ["Warnings, Rate Limits, And Auto-End Escalation"], stories: [71, 72, 78], build: "Show banned/restricted users the restriction duration and broad reason category, and provide a minimal appeal entry point for logged-in users." },
  { title: "Admin Auth, Roles, And Allowlist Seeding", type: "AFK", blockedBy: ["Google Login And Persistent User Session"], stories: [82, 83], build: "Restrict admin tools to Google-authenticated users with database roles and seed initial admins from an allowlist." },
  { title: "Admin Report Review And Case Resolution", type: "AFK", blockedBy: ["Report Trust Weighting And Case Creation", "Admin Auth, Roles, And Allowlist Seeding"], stories: [75, 76, 77], build: "Build minimal admin report queues, context review, and case resolution workflows so safety work does not require database spelunking." },
  { title: "Admin Enforcement Actions And Appeals", type: "AFK", blockedBy: ["Restriction UX And Logged-In Appeal Entry", "Admin Auth, Roles, And Allowlist Seeding", "Admin Report Review And Case Resolution"], stories: [78, 79], build: "Let admins issue warnings, cooldowns, temporary bans, permanent bans, and handle logged-in user appeals." },
  { title: "Admin Feature Flag Management", type: "AFK", blockedBy: ["Feature Flag Audit Logging And Cache Invalidation", "Admin Auth, Roles, And Allowlist Seeding"], stories: [80, 81, 85], build: "Add admin UI/API for changing feature flags and kill switches with audit logs and cached runtime reads." },
  { title: "Media Eligibility And Locked Camera UI", type: "AFK", blockedBy: ["Google Login And Persistent User Session", "Gender Filter Preferences And Honest UI Copy", "Database-Backed Feature Flags", "Realtime Text Message Delivery"], stories: [97, 125, 126], build: "Show camera affordances in chat but keep them locked unless both users are logged in and the camera media flag is enabled, with clear explanations for unavailable states." },
  { title: "Per-Match Media Consent And Revocation", type: "AFK", blockedBy: ["Media Eligibility And Locked Camera UI"], stories: [98, 99, 100, 101], build: "Request media consent once per match from both users, unlock media only when both consent, and allow either user to revoke consent mid-chat." },
  { title: "Camera Capture And Preview UI", type: "AFK", blockedBy: ["Per-Match Media Consent And Revocation"], stories: [102, 103, 104, 105, 106, 114, 115], build: "Build an in-app getUserMedia camera flow with front-facing default, camera switch when available, capture preview, no file/gallery picker, and honest screenshot safety copy." },
  { title: "Client-Side Image Processing", type: "AFK", blockedBy: ["Camera Capture And Preview UI"], stories: [107, 108], build: "Resize and compress captured camera images client-side and strip EXIF/location metadata before transfer." },
  { title: "WebRTC Signaling And Data Channel Transfer", type: "HITL", blockedBy: ["Per-Match Media Consent And Revocation", "Client-Side Image Processing"], stories: [117, 118, 119, 120], build: "Use Socket.IO only for WebRTC signaling, permission events, and metadata while transferring image bytes over WebRTC data channels with public STUN and managed TURN." },
  { title: "View-Once Media Lifecycle", type: "AFK", blockedBy: ["Per-Match Media Consent And Revocation", "WebRTC Signaling And Data Channel Transfer"], stories: [109, 110, 111, 112, 113, 116], build: "Enforce one pending media item per sender per match, explicit receiver open, 8-second view window, Sent/Opened/Expired sender states, and expiration on match end, disconnect, Next, or consent revocation." },
  { title: "Media Abuse Report Metadata", type: "AFK", blockedBy: ["Report Form Categories And Optional Details", "View-Once Media Lifecycle"], stories: [59, 62, 117], build: "For media abuse reports, persist metadata and eligible surrounding text context without ever storing image bytes on the server." },
  { title: "Sound Effects And Mute Toggle", type: "AFK", blockedBy: ["Realtime Text Message Delivery", "Per-Match Media Consent And Revocation"], stories: [121, 122], build: "Add subtle sounds for match found, new message, and media request events plus a persistent mute toggle." },
  { title: "Responsive Chat Polish And Theme Toggle", type: "AFK", blockedBy: ["Shared UI Tokens And Base Components", "Realtime Text Message Delivery", "Media Eligibility And Locked Camera UI"], stories: [123, 124, 127, 128], build: "Polish the mobile full-screen chat layout, desktop adaptation, dark mode default, and low-cost light mode toggle." },
  { title: "Accessibility QA Pass", type: "AFK", blockedBy: ["Two-Step Next Flow", "Report And Block Match Termination", "Media Eligibility And Locked Camera UI", "Camera Capture And Preview UI", "Responsive Chat Polish And Theme Toggle"], stories: [129, 130], build: "Verify keyboard navigation, visible focus, screen-reader labels, modal accessibility, color contrast, and reduced-motion behavior across the app." },
  { title: "In-House Event Tracker", type: "AFK", blockedBy: ["Cookie And Analytics Consent", "Google Login And Persistent User Session"], stories: [132, 133, 134, 135], build: "Implement first-party event tracking with pseudonymous internal IDs, consent-sensitive behavior, 90-day raw retention, and longer aggregate retention." },
  { title: "Product And Safety Event Coverage", type: "AFK", blockedBy: ["Basic Shared Matchmaking Queue", "Realtime Text Message Delivery", "Report And Block Match Termination", "Per-Match Media Consent And Revocation", "View-Once Media Lifecycle", "In-House Event Tracker"], stories: [137, 138, 139], build: "Emit the MVP product and safety events needed to track match speed, chat quality, reports, blocks, moderation, media lifecycle, WebRTC outcomes, and launch health metrics." },
  { title: "Adaptive Bot Protection", type: "AFK", blockedBy: ["Queue Rate Limits And Reconnect Throttles", "Moderation Rule Engine For Text And Usernames", "In-House Event Tracker"], stories: [140, 141, 142, 143], build: "Trigger adaptive bot protection only on risk signals such as rapid sessions, suspicious IPs, repeated reports, or automation-like queue behavior." },
  { title: "Public And In-App Support Flows", type: "AFK", blockedBy: ["Public Legal And Support Pages", "Google Login And Persistent User Session", "Report Trust Weighting And Case Creation"], stories: [91, 92], build: "Connect the public support/contact path and in-app support entry points so general, legal, report, and account issues can include relevant context where appropriate." },
  { title: "Account Deletion And Retention Rules", type: "AFK", blockedBy: ["Google Login And Persistent User Session", "Generated Display Names And Avatars", "Report Trust Weighting And Case Creation"], stories: [93, 94, 95, 96, 136], build: "Provide logged-in account deletion with confirmation, wipe profile/preferences/display labels, expire guest data by policy, and retain/anonymize/restrict moderation records where needed for safety/legal reasons." },
  { title: "Operational Alerts For Safety And Matching", type: "HITL", blockedBy: ["Basic Shared Matchmaking Queue", "Report Trust Weighting And Case Creation", "In-House Event Tracker"], stories: [86, 87], build: "Add operational alerts for elevated report rate, queue backlog, and match failures, with alert recipients and coverage windows configured for launch." },
  { title: "Operational Alerts For Realtime And Media Reliability", type: "HITL", blockedBy: ["Realtime Text Message Delivery", "WebRTC Signaling And Data Channel Transfer", "In-House Event Tracker"], stories: [88, 89, 90], build: "Add operational alerts for backend error rate, WebSocket disconnect spikes, and WebRTC connection failure spikes." },
  { title: "Launch Hosting, Domains, And Environment Wiring", type: "HITL", blockedBy: ["Marketing Homepage", "Public Legal And Support Pages", "Socket Auth For Guests And Logged-In Users", "Database-Backed Feature Flags", "WebRTC Signaling And Data Channel Transfer", "Operational Alerts For Safety And Matching", "Operational Alerts For Realtime And Media Reliability"], stories: [], build: "Wire production hosting, domains, Cloudflare DNS/security, Vercel apps, backend host, managed PostgreSQL, managed Redis, secrets, and environment configuration once the open launch decisions are confirmed." }
];

function bodyFor(issue, created) {
  const blockedLines = issue.blockedBy.length
    ? issue.blockedBy.map((title) => `- Blocked by #${created.get(title) ?? `TBD (${title})`}`).join("\n")
    : "None - can start immediately";
  const storyLines = issue.stories.length
    ? issue.stories.map((story) => `- User story ${story}`).join("\n")
    : "- Implementation decisions / launch readiness";

  return `## Parent PRD
${parentPrd}

## Slice type
${issue.type}

## What to build
${issue.build} Reference the local PRD sections in \`issues/prd.md\` for detailed product decisions and out-of-scope constraints.

## Acceptance criteria
- [ ] The described end-to-end behavior is implemented across the needed UI, API/realtime, persistence, and operational surfaces for this slice.
- [ ] Tests cover the externally observable behavior and important contracts named in the PRD testing decisions.
- [ ] The slice is independently demoable or verifiable in a local/dev environment without completing later non-blocking slices.

## Blocked by
${blockedLines}

## User stories addressed
Reference by number from the parent PRD:
${storyLines}
`;
}

const created = new Map();

for (const issue of issues) {
  console.log(`Creating: ${issue.title}`);
  const body = bodyFor(issue, created);
  const output = execFileSync(
    "gh",
    ["issue", "create", "--repo", repo, "--title", issue.title, "--body", body],
    { encoding: "utf8" }
  ).trim();
  console.log(output);

  const match = output.match(/\/issues\/(\d+)/);
  if (!match) {
    throw new Error(`Could not parse issue number from gh output for "${issue.title}": ${output}`);
  }
  created.set(issue.title, Number(match[1]));
}

console.log("\nCreated issues:");
for (const [title, number] of created) {
  console.log(`#${number} ${title}`);
}
