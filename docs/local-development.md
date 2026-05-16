# Local Development

## Prerequisites

- Node.js 22 or newer.
- pnpm 10 or newer.
- PostgreSQL and Redis for later backend slices.

## Install

```bash
pnpm install
```

## Run

```bash
pnpm dev
```

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
