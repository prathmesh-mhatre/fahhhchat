# Fahhhchat

Production MVP for anonymous one-to-one stranger text chat with guest access, Google login, realtime matching, safety tooling, and consent-based camera media.

## Workspace

- `apps/www` - public marketing site.
- `apps/app` - chat web app.
- `apps/api` - NestJS realtime/API service.
- `packages/ui` - shared UI primitives and design tokens.
- `packages/config` - shared product constants and environment helpers.
- `issues/prd.md` - source PRD used to create the GitHub implementation issues.

## Scripts

```bash
pnpm install
pnpm dev
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

## First Slice

This scaffold supports issue #1, "Monorepo And App Skeletons". It intentionally establishes the deployment boundaries and first test commands without implementing product flows from later issues.
