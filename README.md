# TAME Trial Fire Repo

This is a separate realistic test repo for TAME.

It runs multiple agent workflows against a live or local TAME API:

- safe code patch: allowed and applied
- risky auth patch: blocked before file write
- safe customer export: allowed
- bulk customer export: blocked
- safe staging deploy: allowed
- risky production deploy: blocked
- safe shell command: allowed
- destructive shell command: blocked
- incident remediation: blocked incidents are closed through TAME remediation

## Run

```bash
cp .env.example .env
```

Edit `.env`:

```bash
TAME_BASE_URL=https://tameapp.vercel.app
TAME_WEB_URL=https://tameapp.vercel.app
TAME_API_KEY=tame_sk_...
TAME_ENVIRONMENT=trial-fire
TAME_TRIAL_GITHUB_REPO=franpfeiffer/tame-trial-fire-demo
```

Then:

```bash
pnpm all
```

## Manual Agent Demo

Run this when you want to watch the real product story:

```bash
pnpm manual
```

What it does:

- uses this attached git repo directly
- requires a clean worktree before it starts
- runs a safe feature agent that changes code and commits to a branch
- authors the safe commit as `TAME Trial Agent <agent@tame.local>`
- pushes the safe branch to GitHub and opens a draft PR
- runs a risky hotfix agent that tries to add an auth bypass
- asks TAME before the risky `apply_patch`
- blocks the risky code before it touches `src/auth/session.ts`
- writes PR-style reports under `agent-reports/<run-id>`
- leaves the blocked incident open so you can complete remediation manually in the TAME dashboard

Set `TAME_TRIAL_GITHUB_REPO` in `.env` to match the GitHub repo attached to this directory. The default is `franpfeiffer/tame-trial-fire-demo`.

If policies already exist, `pnpm setup` reuses them.

## Expected Result

The command should print:

- allowed scenarios executed
- blocked scenarios did not execute
- incident IDs and URLs
- remediation completed for blocked incidents

Open the printed incident URLs in TAME to see evidence, AI remediation, raw events, and remediation status.
