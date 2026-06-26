# Local Development

## Prerequisites

- Node.js 22 or newer.
- pnpm 10 or newer.
- PostgreSQL and Redis for later backend slices.

## Install

```bash
pnpm install
```

## Environment

Copy the example file and adjust as needed:

```bash
cp .env.example .env
```

The API reads `process.env` directly (no dotenv loading yet), so `AUTH_SECRET`
must be present in the shell that runs it — it signs guest session cookies and
the service refuses to start without it. Export it (or your process manager's
env) before `pnpm dev`:

```bash
AUTH_SECRET=dev-secret pnpm dev
```

Leave `REDIS_URL` unset for local dev to use the in-memory guest session store;
set it to run against Redis.

### Google login (dev mode)

Google login uses Auth.js/NextAuth in the chat app, and the API exchanges the
verified Google ID token for a pseudonymous internal user. Real OAuth needs
`GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`. To demo the flow locally without
credentials, set `AUTH_DEV_MODE=true` (API) and `NEXT_PUBLIC_AUTH_DEV_MODE=true`
(app): the login page shows a "test account" button and the API accepts a
clearly-marked mock token. Logged-in users get a durable internal id and
persisted legal/safety acceptance; Google identity is never exposed to the
browser or matched strangers. Do not enable dev mode in production.

## Run

```bash
pnpm dev
```

The API runs via `ts-node-dev` so it can execute the workspace TypeScript
packages directly; the Next apps use their own dev servers.

Default ports:

- Marketing site: `http://localhost:3000`
- Chat app: `http://localhost:3001`
- API: `http://localhost:4000`

## Verify

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

Some scripts intentionally return placeholders until the related package gains real implementation and tests.
