# Architecture

Fahhhchat is split into deployable apps and shared packages so each MVP slice can be implemented without mixing product surfaces.

## Apps

- `apps/www` serves the public marketing site and static legal/support pages.
- `apps/app` serves the authenticated and guest chat experience.
- `apps/api` serves HTTP APIs, Socket.IO realtime events, matchmaking integration, moderation workflows, and operational endpoints.

## Packages

- `packages/ui` contains shared tokens and small primitives used across web apps.
- `packages/config` contains shared constants that need to agree across the frontend and backend.

## Runtime Services

The PRD calls for PostgreSQL for durable records and Redis for matchmaking queues, ephemeral session state, rate limits, and rolling chat buffers. Those integrations start in later slices after the project skeleton is in place.

## Current Scope

This repository currently covers the first tracer-bullet issue: monorepo structure, deployable boundaries, app shells, and baseline commands. Product flows such as auth, legal gating, matching, chat, media, moderation, and admin operations are tracked as follow-up GitHub issues.
