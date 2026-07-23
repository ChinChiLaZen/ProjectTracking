# CLAUDE.md — WorkOS Lite (monday.com-style board app)

Persistent project brief for Claude Code. Read fully before writing code. Update it when a decision changes.

> **START HERE →** Nothing built yet. Next action: **Session 1** in §9.
> Update this line at the end of every session.

**Scope of this version:** solo build, learning/portfolio target, usable app in weeks not months.
It deliberately drops things the full brief has. §10 lists exactly what was dropped, why, and how to add each one back — so this is a *starting point*, not a dead end.

---

## 1. Ground rules

1. **Never call Prisma from a React component.** All data access goes through tRPC procedures.
2. **Every procedure touching board data calls `requireBoardAccess(ctx, boardId, minRole)` first.** No inline re-implementations.
3. **Every query goes through `lib/scope.ts`** — one helper that builds the ownership predicate. Today it filters by workspace membership. This is the single seam that makes adding an Organization layer later cheap (§10).
4. **Never trust a client-supplied `workspaceId`, `userId`, or `role`.** Derive from the session.
5. **No hard deletes.** Use `deletedAt`.
6. **Adding a column type = adding one file** in `lib/columnTypes/`. If you're writing a `switch` on column type outside that folder, extend the registry instead.
7. **Write the Prisma migration and the Zod schema in the same commit.**
8. **One session = one shippable slice.** Past ~10 files, stop and split.
9. **Do not invent library APIs or versions.** Check `package.json` and installed types.

### Do NOT
- Do not add a table for a use case (CRM, hiring, content calendar). Those are **board templates**.
- Do not fetch all items of a board without pagination.
- Do not filter or sort in JavaScript what Postgres can do.
- Do not duplicate filter/sort logic per view type.

### Working protocol with Claude Code
- Read the START HERE line and §9 before proposing work.
- State a plan (files + which session) before writing code.
- Run `pnpm typecheck && pnpm lint && pnpm test` before saying anything is done.
- If something here is underspecified, ask — don't invent a convention.
- If a decision here is wrong, say so and propose the change, then update the file.

---

## 2. Stack & commands

Next.js (App Router, TypeScript) · PostgreSQL · Prisma · tRPC · NextAuth · Tailwind + shadcn/ui · TanStack Query · dnd-kit · Recharts · Vitest.

**No Redis. No BullMQ. No separate worker process.** Background work = a `Job` table in Postgres polled by a cron-triggered route handler (§7). One deploy target, one database.

```bash
pnpm install
pnpm dev
pnpm db:migrate         # prisma migrate dev
pnpm db:seed
pnpm typecheck
pnpm lint
pnpm test
```

`docker-compose.yml` at repo root brings up Postgres only:
```yaml
services:
  postgres:
    image: postgres:16
    environment: { POSTGRES_PASSWORD: dev, POSTGRES_DB: workos }
    ports: ["5432:5432"]
```

```
app/
  (auth)/
  w/[workspaceId]/boards/[boardId]/[[...view]]/
  api/trpc/[trpc]/
  api/cron/jobs/            # cron hits this to drain the Job table
server/
  trpc/                     # routers, context, auth middleware
  services/                 # domain logic (boards, items, jobs)
  db/
lib/
  columnTypes/              # ONE FILE PER COLUMN TYPE
  permissions/
  ordering/
  scope.ts                  # THE ownership predicate — see rule 3
components/
prisma/schema.prisma
```

Document every env var in `.env.example` as it is introduced: `DATABASE_URL`, `NEXTAUTH_SECRET`, `NEXTAUTH_URL`, `GOOGLE_CLIENT_ID/SECRET`, `CRON_SECRET`.

---

## 3. Product vision

Teams organize work as **Workspaces → Boards → Groups → Items**, viewed through **Table** and **Kanban** (Calendar later), with simple **Automations** and a basic **Dashboard**.

**The insight to protect:** one flexible data model (boards / polymorphic columns / items) powers every use case. Use cases ship as **templates**, never as bespoke tables. When a requirement arrives, ask *"which column type expresses this?"* before *"what new table do we need?"*

---

## 4. Data model

```
User
Workspace ── WorkspaceMember (userId, role: owner|member)
  └── Board
        ├── Group                (ordered)
        ├── ColumnDefinition     (ordered; type registry §4.2)
        ├── Item                 (in a Group; ordered)
        │     ├── ColumnValue    (Item × Column)
        │     └── Comment
        ├── View                 (saved config)
        └── Automation
Dashboard ── Widget              (workspace-scoped)
Job                              (background work queue, §7)
ActivityLog                      (append-only, per item)
```

**Decisions — reasoning included, don't reverse silently:**

- **No Organization layer.** Workspace is the top-level scope. Adding an Org above it later is an insert-a-parent migration *if and only if* every query went through `lib/scope.ts` (rule 3). That helper is the price of skipping the layer — pay it from day one.
- **`ColumnValue` = jsonb + typed shadow columns.** Keep this even in lite; it is what makes filtering and sorting possible at all:
  ```
  ColumnValue {
    itemId, columnId, boardId
    value       Json      // canonical, type-specific
    valueText   String?   // text / status label / dropdown label
    valueNumber Decimal?
    valueDate   DateTime?
    valueRefIds String[]  // person ids
    version     Int       // optimistic concurrency (see below)
    @@unique([itemId, columnId])
    @@index([boardId, columnId, valueText])
    @@index([boardId, columnId, valueDate])
  }
  ```
  Filter and sort **always** hit shadow columns; `value` is for rendering. Each column type declares how to derive its projection, and that runs in the same transaction as the write.
- **Ordering: `position Float` with midpoint insert.** Insert between A and B → `(a.position + b.position) / 2`. One row updated per drag, no board-wide rewrite. Float precision exhausts after ~50 inserts between the same pair, so ship a `renumber(scope)` helper and call it when the gap drops below a threshold. (The full brief uses fractional *string* ranks — stronger, slightly more machinery. Float is adequate here; upgrade path in §10.)
- **Option sets (status/dropdown) live on `ColumnDefinition`** as `{id, label, color, order}[]`. Values store `optionId`, never the label — renaming a status must not rewrite N rows.
- **`version Int` on Item and ColumnValue** bumped on every write. Mutations send the version they read; mismatch → `CONFLICT`, client refetches that cell. Cheap now, painful to backfill later.
- **Soft delete** (`deletedAt`) on Board/Group/Item/ColumnDefinition, filtered by default via a Prisma extension.
- **`ActivityLog` records `actorType: user | automation | system`.** Automations need it to avoid re-triggering themselves.

### 4.2 Column type registry — `lib/columnTypes/<type>.ts`

```ts
export const statusColumn: ColumnType<StatusValue> = {
  key: "status",
  valueSchema,                 // Zod — validates ColumnValue.value
  settingsSchema,              // Zod — validates ColumnDefinition.settings
  defaultValue,
  toShadow(value, settings),   // { valueText?, valueNumber?, valueDate?, valueRefIds? }
  filterOperators,             // operators offered + how they map to SQL
  Cell, Editor,                // React components
  toDisplayString(value, settings),
};
```

Phase 1 types: `text`, `status`, `person`, `date`, `number`, `checkbox`.
Later: `long_text`, `dropdown`, `link`, `files`, `timeline`.

**A column type is done when:** registry file + Zod schemas + shadow projection + filter operators + Cell/Editor + unit test + a row in the seed data.

---

## 5. Permissions

Two roles only: **owner** and **member**, held per Workspace.

| Capability | Owner | Member |
|---|:--:|:--:|
| Delete workspace, manage members | ✅ | — |
| Create/delete boards, edit columns & automations | ✅ | — |
| Create/edit/move items, comment, personal views | ✅ | ✅ |
| Read boards in the workspace | ✅ | ✅ |

- `requireBoardAccess(ctx, boardId, minRole)` returns board + role or throws. Never returns `null`.
- Return `NOT_FOUND`, not `FORBIDDEN`, for resources outside the caller's workspace — so IDs can't be probed.
- Permission logic is a pure, unit-tested matrix in `lib/permissions/`, independent of tRPC.

---

## 6. Views

One query path: `useBoardData(boardId, viewConfig)` → `{ groups, items, columns, values }`. Views differ in **presentation only**.

- `viewConfig` = `{ type, filters, sort, groupBy, visibleColumns }`, Zod-validated. Saved views persist this exact object, so an ad-hoc filter and a shared view are the same thing.
- Filters compile to SQL against shadow columns. Never `findMany()` then `.filter()`.
- Pagination: cursor-based per group, 50 items + "load more". Rows virtualized (TanStack Virtual).
- Kanban groups by any `status`/`dropdown`/`person` column; a drag = one `setColumnValue` + one `position` update in one transaction.
- Optimistic updates for edits and drags; roll back **visibly** on error (toast + revert), never silently.
- Search: filter the same query against `valueText`. No separate search infrastructure.

**Performance:** keep a 2,000-item board usable — table scrolls smoothly, filter re-query under ~500 ms. Seed one such board and check it at the end of Phase 1. (The full brief targets 10k; 2k is the honest bar for this scope and still catches N+1 queries and missing indexes.)

---

## 7. Automations & background jobs

```ts
type Automation = {
  id: string; boardId: string; enabled: boolean
  trigger:    { type: "column_changed" | "item_created" | "date_arrives", config: object }
  conditions: { columnId: string, operator: string, value: unknown }[]   // AND only
  actions:    { type: "set_column" | "notify" | "move_group", config: object }[]
}
```

Only three trigger types in the engine. "When status changes" / "when a person is assigned" are **rule-builder presets** that compile to `column_changed` with a `columnId` filter — not separate engine paths.

**Execution:**
1. A service method that changes an item inserts a `Job` row **in the same `$transaction`**. This is the lightweight version of an outbox: no Redis, no lost events if the process dies mid-request.
2. `GET /api/cron/jobs` (protected by `CRON_SECRET`, called every minute by the platform's cron) claims pending jobs with `SELECT ... FOR UPDATE SKIP LOCKED`, runs them, marks them done or failed.
3. **Loop prevention:** each job carries `{ depth, causedByAutomationIds[] }`. Skip an automation already in that list; abort at `depth > 3`. Without this, "when status = Done → set status = Done" spins forever.
4. **Idempotency:** dedupe key `automationId:itemId:jobId`. Retries must not double-notify or double-create.
5. **Retries:** max 3 with backoff, then mark dead and show it in the board's automation log. Silent failure is the worst outcome.
6. **Actions call the same services as user actions**, with `actorType: "automation"` — so validation, shadow projection, and activity logging behave identically.
7. `date_arrives` is evaluated by the same cron sweep, not per-item timers. Store the board's timezone on the Board.

```
Job { id, type, payload Json, status: pending|running|done|failed,
      attempts, runAfter, depth, causedByAutomationIds String[],
      error?, createdAt, claimedAt? }
@@index([status, runAfter])
```

---

## 8. Testing & definition of done

- **Vitest (unit):** column type registry (every type), permission matrix, filter→SQL compiler, ordering helpers, automation condition + loop guard. These are pure functions — no excuse for skipping them.
- **Vitest (integration, real test DB):** tRPC procedures, including a test asserting cross-workspace access fails.
- **Playwright (later, 1 spec):** sign in → create board → add item → edit cell → drag → Kanban.
- **`pnpm db:seed`** produces: 2 users, 1 workspace, a task board, a CRM board, a 2,000-item board, one automation. Every feature adds its fixture here.

**A PR is done when:** typecheck + lint + tests pass, it works from a fresh seed, permissions are enforced and tested, no `switch` on column type outside the registry, and this file is updated if a decision changed.

---

## 9. Build order — sessions

**Session 1 — Skeleton**
Scaffold, docker-compose, Prisma (User/Workspace/WorkspaceMember), NextAuth, tRPC context, `lib/scope.ts`, `requireBoardAccess` + its unit-tested matrix, seed, CI.
*Gate:* a test proving cross-workspace access fails. Nothing else ships until it exists.

**Session 2 — Vertical slice, ONE column type**
Board → Group → Item → ColumnValue with only `text`, through the full registry interface, in a minimal Table view, editable inline, with shadow projection + ActivityLog.
*Gate:* the registry interface survives contact with reality. **Do not build six column types before proving it with one** — fixing a wrong interface across one file is an afternoon; across six it's a refactor you'll avoid doing, and then you live with it.

**Session 3 — Ordering + drag**
`lib/ordering/` with midpoint insert + `renumber`, dnd-kit for items and groups, keyboard sensor on from the start (retrofitting a11y is expensive).
*Gate:* one drag updates exactly one row — assert it in a test.

**Session 4 — Scale check**
2,000-item seed board, virtualization, cursor pagination, filter→SQL compiler.
*Gate:* the §6 bar is met at 3 column types. **Do this before adding more types** — this is what validates the shadow-column design while it's still cheap to change.

**Session 5 — Remaining column types**
`status`, `person`, `date`, `number`, `checkbox`. Should be near-mechanical. If they aren't, the registry interface is still wrong — fix it before adding the sixth.

**Session 6 — Phase 1 close**
Board/Group/Item CRUD polish, roles enforced on every procedure, activity feed, first Playwright spec.
*Gate:* you can run a real project on it.

**Then, in order:** Kanban + saved views → comments + notifications → automations (§7) → dashboard widgets → templates gallery.

**Do not start with:** UI polish, dashboards, automations, or a second view type. All are cheap once the data layer is right and worthless if it isn't.

**Before Session 1:** verify the current major version of every library and pin it, plus Node version in `.nvmrc`.

---

## 10. What this drops, and how to add it back

| Dropped | Why | Cost to add later | How |
|---|---|---|---|
| Organization layer | One tenant level is enough until you have paying teams | **Low, if rule 3 is honored** | Add `Organization`, add `organizationId` to Workspace, extend `lib/scope.ts`. One file changes, not every query. |
| Redis + BullMQ + worker process | Second deploy target and a dependency you don't need until automations are heavily used | Low | Swap the `Job` table drain for BullMQ; the service-layer interface stays the same. |
| Fractional string ranks | Float midpoint is adequate at this scale | Medium | Migration recomputing `position` → `rank`; ordering helpers are already isolated in `lib/ordering/`. |
| Guest role | Two roles cover a solo/small-team app | Low | Add the role + board-level membership rows; the permission matrix is already a pure function. |
| Formula / rollup / `connect_board` | The most complex column types, and unnecessary until boards need to relate | Medium | Add `ItemLink` table + the three registry files. Cycle detection required. |
| Observability stack, rate limiting, strict perf budgets | Real needs, but production needs | Low–Medium | Add Sentry on day one anyway (5 minutes); add rate limiting before the first public signup. |
| Calendar / Gantt views | Table + Kanban cover the core loop | Low | Both read the same `useBoardData` — presentation only. |
