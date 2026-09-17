# Somnolent

A lightweight, collaborative HTTP client — the small alternative to Insomnia.

Write a request once with `{{ base_url }}` / `{{ token }}`, switch environment in
one click, and sync the workspace with a teammate through a shareable key.

pnpm monorepo: `apps/web` (React + Vite), `apps/desktop` (Tauri v2),
`apps/server` (Hono + Drizzle), `packages/core` (types, templating, importers).

## Requirements

| | Linux / WSL | macOS |
|---|---|---|
| Node 24 | `nvm install 24` | `brew install node@24` |
| pnpm 11.20 | `corepack enable` (version comes from `packageManager`) | same |
| Postgres | `docker compose up -d` | Docker Desktop or OrbStack + `docker compose up -d` |
| Desktop only (Tauri) | `libwebkit2gtk-4.1-dev`, `libappindicator3-dev`, `librsvg2-dev`, `patchelf` + `rustup` | `xcode-select --install` + `rustup` |

## Running

```bash
pnpm install
docker compose up -d                    # Postgres on localhost:5435
pnpm --filter @somnolent/server dev     # API on :4000 (migrations run at boot)
pnpm dev                                # web on :5173
pnpm desktop                            # optional: Tauri (starts Vite itself)
```

No `.env` needed — everything defaults in code: `DATABASE_URL`
(`postgres://postgres:somnolent@localhost:5435/somnolent`), `PORT=4000` on the
server, `VITE_API_URL=http://localhost:4000` on the web. Optional:
`PROJECT_CREATE_TOKEN` closes project creation.

The web app persists to `localStorage` under `somnolent-workspace`, so it runs
standalone — no server, no Docker — until you want sync.

## Testing

```bash
pnpm test    # vitest across packages; no Docker needed (server runs on PGlite)
pnpm lint    # tsc --noEmit + oxlint
pnpm build
```

## Known caveat: CORS

The desktop app still sends through the webview's `fetch`, so it hits CORS just
like the browser does. The working escape is the server proxy (`POST /proxy`),
used automatically when `fetch` fails — it requires being signed in.
Moving the desktop transport to `tauri-plugin-http` is still open.
