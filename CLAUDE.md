# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

Fahhhchat is a production MVP for anonymous one-to-one stranger text chat (guest access, Google login, realtime matching, safety tooling, consent-based camera media). The repo is a pnpm + Turborepo monorepo. It is being built slice-by-slice from `issues/prd.md`; only the first tracer-bullet issue (monorepo skeleton, deployable boundaries, app shells) is fully implemented — auth, matching, chat, media, moderation, and admin are tracked as follow-up GitHub issues and not yet built.

## Commands

Run from the repo root; Turbo fans tasks out across the workspace.

```bash
pnpm install
pnpm dev         # runs all three apps in parallel
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm format      # prettier --write .
```

Target a single workspace with a filter, e.g. `pnpm --filter @fahhhchat/api dev` or `pnpm --filter @fahhhchat/app test`. Workspace package names are `@fahhhchat/{www,app,api,ui,config}`.

Default dev ports: marketing `:3000`, chat app `:3001`, API `:4000`.

Note: several `test`/`lint` scripts are placeholders that echo a message (e.g. `apps/api` has no tests, `packages/*` have no lint) until the relevant slice is implemented. A green `pnpm test` does not yet mean meaningful coverage.

## Architecture

Apps are split by **deployment boundary**, not just by concern — each is independently deployable so a slice can be built without mixing product surfaces:

- `apps/www` — public marketing + static legal/support pages (Next.js 15 App Router).
- `apps/app` — authenticated + guest chat experience (Next.js 15 App Router).
- `apps/api` — NestJS service for HTTP APIs, Socket.IO realtime, matchmaking, moderation, ops endpoints. Entry: `apps/api/src/main.ts`; modules under `apps/api/src/modules`. CORS origins are driven by `NEXT_PUBLIC_APP_URL` / `NEXT_PUBLIC_WWW_URL`.

Shared packages are consumed as `workspace:*` source (no build step — they export `./src/index.ts` directly, resolved via the `@fahhhchat/*` path aliases in `tsconfig.base.json`):

- `packages/ui` — shared design tokens (`tokens.ts`) and primitives (`primitives.tsx`), used by both web apps.
- `packages/config` — constants that must agree across frontend and backend (product config, `featureFlagKeys`). When a value needs to be consistent between `apps/api` and the web apps, it belongs here, not duplicated.

Planned runtime services (per PRD, added in later slices): **PostgreSQL** for durable records, **Redis** for matchmaking queues, ephemeral session state, rate limits, and rolling chat buffers.

## Key references

- `issues/prd.md` — source PRD; the authoritative spec the slices are built from.
- `mvp-decisions.md` and `client-brief.md` — product decisions and scope.
- `docs/architecture.md`, `docs/local-development.md` — longer-form versions of the above.

## Conventions

- TypeScript is `strict` with `noEmit`; type-check via `pnpm typecheck` (delegates to `tsc --noEmit` per package).
- When adding a workspace, mirror the existing `package.json` script shape (`dev`/`build`/`lint`/`test`/`typecheck`) so Turbo picks it up.
