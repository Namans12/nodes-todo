# Nodes To-Do

An offline, local-only to-do app where related tasks are **linked as nodes** — completing sub-tasks shrinks the connection graph and crosses off the parent automatically.

> **Canonical repository.** This is the origin of a four-repo family. See [Related repositories](#related-repositories) before starting work — later copies add sync, auth, and native mobile builds.

## Overview

Most to-do apps give you a flat list and, at best, sub-tasks nested one level deep. Nodes To-Do treats a task as a **graph**: any to-do can be connected to any other as part of a larger piece of work. Completing connected items visually shrinks the graph and drives a progress indicator; finish all of them and the parent crosses itself off.

Everything runs on your machine. SQLite on disk, no account, no cloud, no telemetry. Deleted items go to a soft-delete trash that auto-purges after 30 days, and nothing survives in cache or temp files past that.

## Features

- **Groups** — organise to-dos into user-created buckets ("Office", "Home")
- **Node connections** — link related to-dos into a task graph with live progress
- **Graph view** — visual rendering of connections between tasks
- **Rich descriptions** on every item
- **Soft-delete trash** with automatic 30-day purge
- **Batch operations** — complete, delete, or move many items at once
- **Search and filter** with relevance sorting
- **Reminders** with an in-app alarm modal
- **Fully offline** — zero network calls

## Tech Stack

**Backend** — Node.js · TypeScript (strict) · [Hono](https://hono.dev) 4 · SQLite via `better-sqlite3` 12 · Drizzle ORM 0.45 · Vitest · port `8080`

**Frontend** — React 19 · Vite 6 · TypeScript 5.9 · Tailwind CSS 3.4 · Framer Motion 11 · Lucide icons · react-hot-toast

## Prerequisites

- Node.js LTS
- npm

## Installation

```bash
git clone https://github.com/Namans12/nodes-todo.git
cd nodes-todo
```

Backend:

```bash
cd app
npm install
npm run db:migrate
```

Frontend, in a second terminal:

```bash
cd frontend
npm install
```

## Usage

Start the API on `:8080`:

```bash
cd app
npm run dev
```

Start the UI:

```bash
cd frontend
npm run dev
```

### Scripts

| Location | Command | Does |
|---|---|---|
| `app/` | `npm run dev` | API with hot reload (`tsx watch`) |
| `app/` | `npm start` | API without watch |
| `app/` | `npm test` | Vitest suite |
| `app/` | `npm run test:watch` | Vitest in watch mode |
| `app/` | `npm run db:generate` | Generate Drizzle migrations |
| `app/` | `npm run db:migrate` | Apply migrations |
| `app/` | `npm run build` | Compile with `tsc` |
| `frontend/` | `npm run dev` | Vite dev server |
| `frontend/` | `npm run build` | Type-check and build |
| `frontend/` | `npm run preview` | Serve the build |

## API

All routes are mounted under `/api`:

| Route | Purpose |
|---|---|
| `/api/groups` | Group CRUD |
| `/api/groups/:groupId/todos` | To-dos within a group |
| `/api/todos` | To-do CRUD |
| `/api/todos/batch` | Batch complete / delete / move |
| `/api/trash` | Soft-deleted items and restore |
| `/api/connections` | Node links between to-dos |
| `/api/search` | Search with relevance sorting |

## Project Structure

```
app/                      backend
  src/
    app.ts                Hono app, route mounting
    index.ts              server entry
    db/
      schema.ts           Drizzle schema
      connection.ts       SQLite connection
      migrate.ts          migration runner
    routes/               groups, todos, batch, trash, connections, search
    tests/                Vitest suites, one per route
  drizzle.config.ts
  SPEC.md                 full product specification
  DEVELOPMENT-LOG.md      build history

frontend/                 React UI
  src/
    App.tsx
    api/client.ts         typed API client
    components/
      GraphView.tsx       node-connection graph
      TodoList.tsx / TodoItem.tsx
      ConnectionView.tsx / ConnectionModal.tsx / ConnectionInline.tsx
      SearchView.tsx / TrashView.tsx / Sidebar.tsx
      ReminderAlarmModal.tsx
```

## Testing

```bash
cd app && npm test
```

Suites cover groups, todos, batch, trash, connections, search, database, persistence, and health.

## Documentation

- [`app/SPEC.md`](app/SPEC.md) — full specification: data model, phases, requirements
- [`app/DEVELOPMENT-LOG.md`](app/DEVELOPMENT-LOG.md) — how it was built

## Related Repositories

This project was copied and continued three times. Nothing was merged back.

| Repo | Relationship |
|---|---|
| [`nodes-todo-backend`](https://github.com/Namans12/nodes-todo-backend) | The API developed standalone, feature by feature, before the frontend existed. Same backend, cleaner commit history |
| [`to-do-updated`](https://github.com/Namans12/to-do-updated) | Copy from 2026-02-27. Adds live sync, backups, templates, recurrence, and activity history |
| [`to-do-better`](https://github.com/Namans12/to-do-better) | Copy from 2026-03-24, furthest along. Adds Supabase auth and cloud sync, Capacitor Android and Tauri desktop wrappers, Playwright E2E |

**If you want the most capable version, use [`to-do-better`](https://github.com/Namans12/to-do-better).** This repo remains the cleanest expression of the original offline-only idea.
