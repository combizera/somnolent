# Somnolent

API client (Insomnia-like). pnpm monorepo: `apps/web` (React + Vite),
`apps/server` (Hono + Drizzle), `packages/core` (types, templating, importers).

## Language

**Code is English**: comments, test names (`describe`/`it`) and UI strings
(labels, placeholders, `title`, `aria-label`, error messages).

Chat with the user and commit/PR messages stay in Portuguese.

## Comments

**Short**: one line, two at most. No 5+ line blocks walking through the whole
reasoning — not in code, not in tests, not in CSS.

A comment explains *why*, never *what*. If it needs more than two lines, it
belongs in the PR message, not the file.

```ts
// Good
// Firefox needs a payload or the drag never starts.
e.dataTransfer.setData('text/plain', id)

// Bad
/**
 * The setData call is not decoration: Firefox only starts a drag when the
 * dataTransfer carries something. Without it the gesture dies at dragstart and
 * the tab never reaches the neighbour's dragover, so reordering never happens.
 */
```

## UI conventions

Button labels start with a capital, or are icon-only — never a bare lowercase
word.

## Commands

```
pnpm dev     # web on :5173
pnpm test    # vitest across packages
pnpm lint    # tsc --noEmit + oxlint
pnpm build
```
