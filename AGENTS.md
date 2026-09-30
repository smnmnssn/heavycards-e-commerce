# Agent guide

- [PROJECT.md](PROJECT.md) is the canonical specification. Read it in full before changing files and work milestone by milestone.
- Record meaningful decisions in [docs/architecture.md](docs/architecture.md).
- Pin dependencies exactly (no `^`/`~`). Verify compatibility before adding or upgrading a package.
- Before reporting work as done, run: `npm run format:check`, `npm run lint`, `npm run typecheck`, `npm test`, `npm run build` and `npm run test:e2e`.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
