# Bob 2.0 — Project Context

## Purpose
AI agent pipeline that diagnoses, fixes, and verifies broken repos.

## Stack
- Next.js (App Router)
- Supabase (DB)
- IBM Bob API (via src/lib/bob wrapper)

## Agent pipeline
diagnose → fix → verify → headAgent (orchestrator)

## Rules
- All Bob API calls MUST go through src/lib/bob
- Never commit .env.local
- Keep agent logic in src/lib/agents

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
