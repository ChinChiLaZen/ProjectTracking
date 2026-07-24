# CLAUDE.md — WorkOS (monday.com-style Project Tracking & Dashboard Platform)

Persistent project brief for Claude Code. **Read §0–§4 fully before writing any code.**
This file is the source of truth for architecture, conventions, and invariants. Update it in the same PR whenever a decision changes — a stale brief is worse than none.

> **START HERE →** Session 11 is done — **`dropdown` + `timeline`, closing out Phase 2's named column types.** `dropdown` is single-select, `valueText`-shadowed — `lib/columnTypes/types.ts`'s own Decision 2 comment (written in Session 2, before `dropdown` existed) already grouped it with `text`/`long_text`/`status` on `valueText`, settling a design question (multi-select like `person`? no) before it had to be guessed at. `timeline` is `{start, end}`, `valueDate`/`valueDateEnd`-shadowed — `ColumnValue.valueDateEnd` has sat unused in the schema since Session 1 for exactly this. Both slotted into existing shadow-field machinery with **zero changes** to `operators.ts`, `compileQuery.ts`, `viewConfig.ts`, or any router/service file — the actual proof the Sessions 2–9 registry design was sound. Generalized `lib/views/kanbanGroupKeyValue.ts`'s `isKanbanGroupable`/`valueForGroupKey` from a hardcoded `["status","person"]` key list to branching on **`shadowField`** (`valueText`/`valueRefIds`) instead — `dropdown` became Kanban-groupable for free (falls into the same branch `status` already used), and the change follows Session 9's own stated bar for generalizing ("once more than one type needs it") now that `dropdown` is a second `valueText` type. Found and fixed a real integration gap while wiring `timeline` into Calendar: `CalendarBoard.tsx`'s day-bucketing loop only handled a plain date *string* value (`date`'s shape) — a `timeline` column, offered by the same already-generic `shadowField === "valueDate"` picker, would have silently rendered an empty grid (its value is `{start,end}`, not a string) rather than erroring. Fixed with a small `dayKeyForDateValue` helper that reads either shape; a `timeline` item shows on its *start* day only — full multi-day span rendering is deferred to a future Gantt-focused session (§6 already treats Calendar and Gantt as separate views). Next action: Phase 2's core is now fully closed (Kanban, Calendar, filter/sort-builder, saved views, `dropdown`, `timeline`) — remaining Phase 2 items are the shared global search UI (§6.1, not yet built — only in-board filtering exists) or `link`/`files`/`connect_board`/`formula`/`rollup`/`rating` (all still "Later" per §4.3), or consider Phase 2 closed and move to Phase 3 (Collaboration) — no session plan exists for any of these yet in §10.1, write one before starting.
> Update this line at the end of every session. It is the first thing to read and the easiest thing to let go stale.

---

## 0. How to use this file

| Section | Read when |
|---|---|
| §1 Ground rules | Always, before any change |
| §2 Commands & repo layout | Always |
| §3 Product vision | Starting a new feature area |
| §4 Data model | Touching Prisma schema, queries, or column types |
| §5 Permissions | Writing any procedure |
| §6 Views | Working on table/kanban/calendar/chart/gantt |
| §7 Automations | Working on the rule engine or queue |
| §8 Performance budgets | Any list/query/render work |
| §9 Testing & DoD | Before opening a PR |
| §10 Build phases + §10.1 session plan | Choosing what to work on next |
| §11 Conventions | Always |
| §12 Observability & security | Setting up logging/errors, or touching auth/uploads/rich text |
| §13 Risks & open decisions | When something here feels underspecified |
| §14 Decision log | After making an architectural decision — append, don't rewrite history |

**If this file exceeds ~500 lines, split details into `/docs/*.md` and keep only the rules + pointers here.** Long briefs get skimmed.

---

## 1. Ground rules (non-negotiable)

1. **Never call Prisma from a React component.** All data access goes through tRPC procedures.
2. **Every procedure that touches board data calls `requireBoardAccess(ctx, boardId, minRole)` first.** No exceptions, no inline re-implementations.
3. **Every query is scoped by `organizationId`.** Tenant isolation is enforced in the query, not by trusting an ID from the client.
4. **Never trust a client-supplied `organizationId`, `workspaceId`, `userId`, or `role`.** Derive them from the session.
5. **No destructive deletes.** Use `deletedAt`. Hard delete only via an explicit, audited admin job.
6. **Adding a column type must mean adding one file** in `columnTypes/`, not editing every view. If you find yourself adding a `switch` on column type outside that registry, stop and extend the registry instead.
7. **Automations never run inline in a request.** They are enqueued; the request path returns immediately.
8. **Write the migration and the Zod schema together.** A schema change without matching validation is an incomplete change.
9. **Commit in small working slices.** Prefer a shipped vertical slice over a broad half-finished layer.
10. **Do not invent library APIs or version numbers.** If unsure of a package's current API, check `package.json` / the installed types before using it.

### Do NOT do these (common failure modes on this codebase)
- Do not add a new "feature table" for a use case (CRM, hiring, content calendar, airport project tracking) — those are **board templates**, not new schema.
- Do not fetch all items of a board without pagination.
- Do not filter or sort in JavaScript what the database can filter or sort.
- Do not duplicate filter/sort/permission logic per view type.
- Do not let an automation write directly to the database — it goes through the same service layer as a user action, with `actor = automation`.

### 1.1 Working protocol (how to run a session on this repo)

1. **Read the START HERE line and §10.1 before proposing work.** Do not begin a phase whose predecessor's *done-when* is unmet.
2. **State a plan before writing code** — files to be created/changed, and which §10.1 session it belongs to. If the request doesn't map to a session, say so rather than improvising scope.
3. **One session = one shippable slice.** If a slice grows past ~10 files, stop and split it.
4. **Run `pnpm typecheck && pnpm lint && pnpm test` before declaring anything done.** "It should work" is not done.
5. **Do not create files outside the §2 layout** without saying why and updating §2.
6. **When a decision here turns out to be wrong, say so explicitly and propose the change** — then update the section and append to §14. Do not silently code around this file.
7. **When something here is underspecified, ask rather than assume** — an invented convention is more expensive to unwind than a question.

---

## 2. Commands & repo layout

> Fill in exact commands once the repo is scaffolded; keep this table accurate — it is the first thing Claude Code reads.

```bash
pnpm install
pnpm dev                 # Next.js dev server
pnpm worker              # BullMQ automation/notification worker (must run alongside dev)
pnpm db:migrate          # prisma migrate dev
pnpm db:studio           # prisma studio
pnpm db:seed             # seed org + workspace + demo boards (see §9)
pnpm typecheck           # tsc --noEmit
pnpm lint
pnpm test                # Vitest unit/integration
pnpm test:e2e            # Playwright
```

```
app/
  (auth)/                       # sign-in, sign-up
  (workspace)/[workspaceId]/
    boards/[boardId]/[[...view]]/
    dashboards/[dashboardId]/
    settings/
  api/
    trpc/[trpc]/                # tRPC handler
    webhooks/                   # external integrations ONLY
server/
  trpc/                         # routers, context, middleware (auth, tenancy, rate limit)
  services/                     # domain logic: boards, items, automations, notifications
  db/                           # prisma client, query helpers, transaction utils
  jobs/                         # BullMQ queues, workers, job definitions
lib/
  columnTypes/                  # ONE FILE PER COLUMN TYPE (see §4.3)
  permissions/                  # role matrix + requireBoardAccess
  ordering/                     # fractional index helpers
components/
  board/ views/ dashboard/ ui/
prisma/schema.prisma
docs/                           # ADRs and long-form design notes
```

**Environment variables** — document every one in `.env.example` the moment it is introduced: `DATABASE_URL`, `REDIS_URL`, `NEXTAUTH_SECRET`, `NEXTAUTH_URL`, `GOOGLE_CLIENT_ID/SECRET`, `S3_*`, `EMAIL_*`.

### 2.1 Infrastructure & deployment (do not skip this — it changes the architecture)

**The BullMQ worker (`pnpm worker`) is a long-running process. It cannot run as a Vercel serverless function.** This is a hosting-topology decision, not a detail — get it wrong and Phase 4 automations silently never fire in production even though they work in `pnpm dev`. Two valid options:
- Deploy the worker as a small always-on service (Railway/Fly.io/Render/a single VM) alongside the Vercel-hosted Next.js app, both pointing at the same Postgres + Redis.
- Or replace BullMQ with a serverless-friendly queue (e.g. a Postgres-backed job table polled by a Vercel Cron trigger) if avoiding a second deployment target matters more than queue features.
Pick one before Phase 4 starts and record it in §14 Decision log — don't let it default silently.

**Local dev** — provide a `docker-compose.yml` at repo root bringing up Postgres and Redis so `pnpm dev` + `pnpm worker` work with zero external accounts:
```yaml
services:
  postgres:
    image: postgres:16
    environment: { POSTGRES_PASSWORD: dev, POSTGRES_DB: workos }
    ports: ["5432:5432"]
  redis:
    image: redis:7
    ports: ["6379:6379"]
```
**Environments** — local → staging → production, same schema, staging seeded with the same `pnpm db:seed` fixtures (§9) so bugs reproduce before prod. Migrations run via `prisma migrate deploy` in the deploy pipeline, never `db push` outside local dev.

---

## 3. Product vision (compact)

Teams organize work as **Workspaces → Boards → Groups → Items**, see it through multiple **Views** (Table, Kanban, Calendar, Chart, Gantt), automate it with **Automations**, and summarize it in cross-board **Dashboards**.

**The insight to protect:** one flexible data model (boards / polymorphic columns / items) powers every use case — task tracking, CRM, hiring pipeline, content calendar, phased infrastructure/procurement projects. Use cases ship as **templates + column types**, never as bespoke feature verticals. Every time a new requirement arrives, the first question is *"which column type or view config expresses this?"* before *"what new table do we need?"*

---

## 4. Data model

### 4.1 Shape

```
Organization
  ├── User (member of Organization; membership rows carry role)
  └── Workspace
        ├── Board
        │     ├── Group                 (ordered sections within a board)
        │     ├── ColumnDefinition      (ordered; type registry in §4.3)
        │     ├── Item                  (belongs to a Group; ordered within group)
        │     │     ├── ColumnValue     (Item × ColumnDefinition, jsonb + shadow cols)
        │     │     ├── Update          (comment thread; @mentions)
        │     │     └── ActivityLog     (append-only)
        │     ├── View                  (saved config: type, filters, sort, grouping; shared|personal)
        │     └── Automation            (trigger + conditions + actions; §7)
        └── Dashboard                   (workspace-scoped, NOT board-scoped)
              └── Widget                (queries one or more Boards)
ItemLink                                (item ↔ item, backs connect_board)
Notification, Attachment, AutomationRun, OutboxEvent (§7.1), Invitation
```

### 4.2 Modeling decisions (and the reasoning — do not silently reverse these)

- **`organizationId` is denormalized onto every tenant-owned table.** Costs a column; buys single-predicate tenant isolation and simple composite indexes. Enforce it in a Prisma middleware/extension as a second line of defence.
- **IDs:** `cuid2` (sortable-ish, URL-safe, no PK enumeration). Items additionally get a human-facing per-board sequential `number` for display and search ("#412").
- **Ordering: fractional indexing, not integer `position`.** Store `rank` as a `String` (lexicographic, e.g. the `fractional-indexing` approach). Integer positions force an O(n) rewrite on every drag and break under concurrent reorders; fractional ranks make a drag a single-row update. Provide `lib/ordering/` helpers plus a `rebalanceRanks(scope)` maintenance job for the rare precision blow-out. Applies to Group-in-Board, Item-in-Group, ColumnDefinition-in-Board, Widget-in-Dashboard.
- **`ColumnValue` is jsonb + typed shadow columns.** This is the most important performance decision in the project. Store the canonical value in `value jsonb`, and *also* write indexable projections:
  ```
  ColumnValue {
    itemId, columnId, organizationId, boardId
    value        Json      // canonical, type-specific shape
    valueText    String?   // text/status label/dropdown label — full-text + ILIKE
    valueNumber  Decimal?  // number/rating/formula result
    valueDate    DateTime? // date/timeline start
    valueDateEnd DateTime? // timeline end
    valueRefIds  String[]  // person ids / linked item ids — GIN indexed
    @@unique([itemId, columnId])
    @@index([boardId, columnId, valueText])
    @@index([boardId, columnId, valueNumber])
    @@index([boardId, columnId, valueDate])
  }
  ```
  Filtering and sorting **always** target shadow columns; `value` is for rendering. Each column type in the registry declares how to derive its shadow projections, and that derivation runs in the same transaction as the write.
- **Option sets (status/dropdown) live on `ColumnDefinition`** as `{id, label, color, order}[]`; values reference `optionId`, never the label. Renaming a status must not rewrite N item rows.
- **Soft delete** (`deletedAt`) on Board / Group / Item / ColumnDefinition. Deleting a Group soft-deletes its Items (cascade in the service layer, recorded in ActivityLog). A global Prisma extension filters `deletedAt: null` by default; restoring is an explicit admin path with a 30-day retention window before the purge job runs.
- **`connect_board` gets a real relation table (`ItemLink`), not JSON.** Rollup and formula columns depend on traversing it; JSON arrays cannot be joined or indexed usefully at scale.
- **Formula columns:** evaluate on read in Phase 6 with a whitelisted expression evaluator (no `eval`, no arbitrary JS). Build a dependency DAG per board and **reject cycles at save time**. Only cache/materialize results if profiling shows a need.
- **`ActivityLog` records `actorType: user | automation | system` and `actorId`.** Automations depend on this to avoid re-triggering themselves (§7).
- **Optimistic concurrency from Phase 1:** `Item` and `ColumnValue` carry a `version Int` bumped on every write. Mutations send the version they read; a mismatch returns `CONFLICT` and the client refetches that cell. Resolution stays last-write-wins for now (§13), but the column must exist from the first migration — adding it later means backfilling live data and rewriting every mutation.
- **`OutboxEvent` table** — see §7.1. Domain events are persisted in the same transaction as the change that produced them, never enqueued directly.

### 4.3 Column type registry — `lib/columnTypes/<type>.ts` + `<type>.client.tsx`

**Two files per type, not one** (Session 9 — see §14's 2026-07-24 "real production bug" entries for why): `<type>.ts` has no `"use client"` and holds everything except `Cell`/`Editor` — schemas, `toShadow`/`isEmpty`/`groupKeys`/`toDisplayString`/`parse`, and the final assembled `export const <type>Column: ColumnType<...>`, importing `Cell`/`Editor` from the sibling file. `<type>.client.tsx` is `"use client"` and exports only `<Type>Cell`/`<Type>Editor`. This isn't optional stylistic split — a single `"use client"` file mixing components with plain server-usable logic makes Next's RSC bundler wrap *every* export (including a Zod schema) as a client reference once reached from server code, which silently breaks at runtime, not at typecheck. `registry.ts` still imports the assembled object via `./`\<type\> (unambiguous — only `<type>.ts` matches that bare specifier).

Every column type exports one object implementing a shared interface. Interface below was stress-tested against `person` (array value), `date` (two-argument operators, timezone), and `formula` (no stored value) before `text` was implemented against it — see `lib/columnTypes/types.ts` for the full annotated contract (five numbered decisions in the file comments). Do not simplify this back down while adding new column types:

```ts
export const statusColumn: ColumnType<StatusValue, StatusSettings> = {
  key: "status",
  computed?: boolean,                        // formula/rollup only — setColumnValue rejects writes when true
  valueSchema,                                // Zod — validates ColumnValue.value
  settingsSchema,                             // Zod — validates ColumnDefinition.settings (option sets etc.)
  defaultValue: (settings) => StatusValue,    // a function, not a constant — some defaults depend on settings
  shadowField: "valueText",                   // which shadow column this type filters/sorts on
  toShadow: (ctx: DeriveContext) => Shadow,   // ctx carries value/settings/item/sibling values+columns/timeZone —
                                               // computed types need the siblings; plain types ignore them
  isEmpty: (value) => boolean,
  groupKeys: (value, settings) => GroupKey[], // 0..n buckets — e.g. multi-assignee person puts an item in 2 Kanban columns
  extraOperators?, reconcileValues?,          // escape hatch; option-set migration hook
  toDisplayString(value, settings),           // used by search, exports, notification text
  parse(input, settings),                     // CSV/paste ingestion — returns null on unparseable input
  Cell, Editor,                                // React components — Cell takes `readOnly`, Editor reports via onChange/onCancel
};
```
No `sortComparator` on the interface by design — sorting is `ORDER BY <shadowField>` in SQL; if a type can't be sorted by its shadow field, the shadow projection is wrong, not this interface. Filter operators are declared per shadow field (shared across every column type that uses it), not per column type — see `lib/columnTypes/operators.ts` (Session 4, not built yet).

Phase 1 types: `text`, `long_text`, `status`, `person`, `date`, `number`, `checkbox`.
Phase 2 types (Session 11): `dropdown` (single-select, `valueText`-shadowed — structurally near-identical to `status`, a plain categorical field rather than a colored workflow one), `timeline` (a `{start, end}` date range, `valueDate`/`valueDateEnd`-shadowed — Calendar shows it on its start day only; multi-day span rendering is a future Gantt-session concern).
Later: `link`, `files`, `connect_board`, `formula`, `rollup`, `rating`.

**Definition of "column type is done":** registry file + Zod schemas + shadow projection (`shadowField`/`toShadow`) + `isEmpty`/`groupKeys`/`parse` + cell/editor + unit tests + one row in the seed data. Anything less is not done. (Per-shadow-field filter operator sets live once in `lib/columnTypes/operators.ts`, Session 4 — a column type only needs `extraOperators` if it wants something beyond its shadow field's shared set.)

---

## 5. Permissions

Roles are held per **Organization** and per **Board** (workspace membership grants a default board role; explicit board membership overrides it).

| Capability | Owner | Admin | Member | Guest |
|---|:--:|:--:|:--:|:--:|
| Manage org, billing, delete workspace | ✅ | — | — | — |
| Create/delete boards, manage board members | ✅ | ✅ | — | — |
| Edit columns, automations, shared views | ✅ | ✅ | — | — |
| Create/edit/move items, comment | ✅ | ✅ | ✅ | ✅ (assigned boards only) |
| Create personal views | ✅ | ✅ | ✅ | ✅ |
| Read board | ✅ | ✅ | ✅ | ✅ (assigned boards only) |

Rules:
- `requireBoardAccess(ctx, boardId, minRole)` returns the resolved board + role, or throws `FORBIDDEN`. It never returns `null` for the caller to interpret.
- **Guests never see the workspace sidebar or cross-board dashboards** — only boards they are explicitly added to.
- Return `NOT_FOUND` rather than `FORBIDDEN` for resources outside the caller's tenant, so IDs cannot be probed.
- Permission logic lives in `lib/permissions/` and is unit-tested as a pure matrix, independent of tRPC.

---

## 6. Views

All views read from **one** query path: `useBoardData(boardId, viewConfig)` → normalized `{ groups, items, columns, values }`. Views differ in **presentation and grouping only**. Filter, sort, permission, and pagination logic lives once, server-side.

- `viewConfig` is a single Zod-validated object: `{ type, filters, sort, groupBy, visibleColumns, swimlaneBy?, dateColumnId?, chartConfig? }`. Saved views persist exactly this object — so a shared view and an ad-hoc filter are the same thing.
- **Filters compile to SQL against shadow columns.** Never `findMany()` then `.filter()` in JS.
- **Pagination:** cursor-based, per group, default 50 items with "load more"; rows virtualized with TanStack Virtual. A board must stay usable at 10,000 items.
- **Kanban:** groups by any `status`/`dropdown`/`person` column; drag = one `setColumnValue` + one `rank` update in a single transaction.
- **Calendar / Gantt:** driven by `date` / `timeline` columns; query by date range, never load the whole board.
- **Optimistic updates** for inline edits and drag-and-drop; always reconcile from the server response and roll back visibly on error (toast + revert), never silently.

### 6.1 Search & import/export

- **In-board search** filters the current `useBoardData` query against `valueText`/`valueRefIds` shadow columns — same path as filters, just a free-text predicate.
- **Global search** (across boards in a workspace) is a separate, explicitly-scoped query: Postgres full-text (`tsvector` on `valueText` + item name) is the default per §13; it must still run `requireBoardAccess` per matched board so results never leak items from boards the user can't open.
- **CSV import** creates a Board + ColumnDefinitions from header row + a sampled-row type guess, then inserts Items through the normal service layer (not a bulk raw-SQL path) so validation, shadow projections, and ActivityLog all run identically to manual entry. Cap import size in v1 (e.g. 5k rows) and report row-level failures rather than aborting the whole import.
- **Export** (CSV) reads the same `useBoardData` result a Table view would show — respects current filters/visible columns, so "export this view" is literally true.

---

## 7. Automation engine

```ts
type Automation = {
  id: string
  boardId: string
  enabled: boolean
  trigger: { type: "column_changed" | "item_created" | "date_arrives" | "item_moved", config: object }
  conditions: { columnId: string, operator: string, value: unknown }[]   // AND semantics in v1
  actions: { type: "set_column" | "notify" | "create_item" | "move_group" | "create_update", config: object }[]
}
```

**Only four trigger types exist in the engine.** "When status changes" and "when a person is assigned" are *presets in the rule-builder UI* that compile to `column_changed` with a `columnId` and optional `toValue` in config. Do not add engine-level trigger types for what is already a `column_changed` with a filter — every extra trigger type is a second code path that will drift from the first.

Execution contract — these are the parts most likely to be missed, so treat them as requirements:

1. **Event-driven, out of band.** The service layer emits a domain event (`item.column_changed`, `item.created`, …) after a successful transaction; the worker consumes it. A slow or failing automation must never block a user's edit.
2. **Loop prevention.** Every event carries `{ depth, causedByAutomationIds[] }`. Skip an automation if it already appears in `causedByAutomationIds`; abort the chain at `depth > 3` and log it. Without this, "when status = Done → set status = Done" takes down the worker.
3. **Idempotency.** Job dedupe key = `automationId:itemId:eventId`. Retries must not double-create items or double-send notifications.
4. **Retries.** Exponential backoff, max 3 attempts, then dead-letter + surface the failure in the board's automation log UI. Silent failure is the worst outcome here.
5. **`AutomationRun` is a real table** (`automationId, itemId, status, startedAt, finishedAt, error, actionsApplied`). Users need to see why an automation did or didn't fire; you need it to debug.
6. **Actions go through the same services as user actions**, with `actorType: "automation"` — so validation, shadow-column derivation, activity logging, and permissions all behave identically.
7. **`date_arrives` runs from a scheduled sweep** (repeatable job, hourly), not per-item timers. Store the board's timezone on the Board.

### 7.1 Transactional outbox (do not skip — this is the subtle one)

"Emit the event after the transaction commits" is *not* sufficient. If the process dies between commit and `queue.add()`, the change is saved and the automation never runs — silently, with no error anywhere. Once users trust automations, this class of bug is very hard to diagnose from a bug report.

So: **write the event into an `OutboxEvent` row inside the same `$transaction` as the data change.** A relay (a repeatable job, or Postgres `LISTEN/NOTIFY`) reads unpublished rows, enqueues them to BullMQ, and marks them published. Delivery becomes at-least-once, which the idempotency key in (3) already makes safe.

```
OutboxEvent { id, organizationId, boardId, itemId, type, payload Json,
              actorType, actorId, depth, causedByAutomationIds String[],
              createdAt, publishedAt? }
@@index([publishedAt, createdAt])
```

This also makes the automation trigger path replayable, which is what §12's run-history and any future real-time transport (§13) will both read from. Build it in Phase 4, but **create the table and write to it from Phase 1** — retrofitting event emission across every service method later is the expensive version of this.

---

## 8. Performance budgets

Treat these as acceptance criteria, not aspirations. Add the seed script's "big board" (10k items × 12 columns) to CI.

| Target | Budget |
|---|---|
| Board first paint (50 items) | < 1.0 s p75 |
| Inline cell edit → optimistic paint | < 50 ms |
| Cell edit → server ack | < 300 ms p75 |
| Filter/sort re-query on 10k-item board | < 500 ms p75 |
| Drag reorder | 1 row updated, no board-wide rewrite |
| Dashboard widget (aggregate over 3 boards) | < 800 ms p75, cached 60 s |

Rules of thumb: aggregate in SQL, not in the app; never N+1 across `ColumnValue`; batch item + values in one round trip; cache dashboard widget results with an explicit invalidation key.

---

## 9. Testing & definition of done

- **Vitest** — column type registry (every type), permission matrix, filter→SQL compiler, ordering helpers, automation condition evaluation and loop guard. These are pure functions; there is no excuse for them to be untested.
- **Integration (Vitest + test DB)** — tRPC procedures with a real Prisma client against a throwaway Postgres, including tenant-isolation tests that assert cross-org access fails.
- **Playwright** — the critical flows only: sign in → create board → add item → inline edit → drag to reorder → switch to Kanban → create an automation → verify it fires → dashboard widget shows the number.
- **Seed data** (`pnpm db:seed`) must produce: 1 org, 2 workspaces, a task board, a CRM board, a hiring board, an airport-project board (seeded with the 4 phase groups from §10 Phase 6), one board with 10k items, 3 users with different roles, and at least one automation. Every new feature adds its fixture here.

**A PR is done when:** typecheck + lint + tests pass, the feature works from a fresh `db:seed`, permissions are enforced and tested, no new `switch` on column type outside the registry, and this file is updated if a decision changed.

---

## 10. Build phases

Each phase must be usable end-to-end before the next begins. Acceptance criteria are the gate — not a checklist of code written.

**Phase 0 — Skeleton (new)**
Repo scaffold, Prisma schema for Organization/Workspace/User/membership, NextAuth with both providers, tRPC context with session + tenancy middleware, `requireBoardAccess`, seed script, CI running typecheck/lint/test.
*Done when:* a seeded user can sign in and land on an empty workspace, and a cross-tenant request provably fails a test.

**Phase 1 — Foundation**
Board/Group/Item CRUD, column types `text`/`long_text`/`status`/`person`/`date`/`number`/`checkbox`, Table view with inline editing, drag-to-reorder (fractional ranks), role-based permissions, ActivityLog.
*Done when:* a user can run a real project on it. Seeded 10k-item board scrolls and edits within §8 budgets.

**Phase 2 — Views**
Kanban, Calendar, shared filter/sort/group/search controls, saved views (shared + personal), `dropdown` and `timeline` columns.
*Done when:* switching views never re-implements filtering, and a saved view URL is shareable.

**Phase 3 — Collaboration**
Item updates/comments, @mentions, file attachments (S3, local-disk adapter in dev), notifications (in-app + daily email digest), full activity feed.
*Done when:* a mention reliably produces one notification and one email, deduped.

**Phase 4 — Automations**
Rule builder UI, the trigger/action sets in §7, queue worker, `AutomationRun` log with a visible run history.
*Done when:* the loop-prevention test suite passes, including a deliberately self-triggering rule.

**Phase 5 — Dashboards**
Workspace dashboards, resizable widget canvas, widget types (number, chart, table, progress), cross-board aggregation with caching.
*Done when:* a widget aggregating 3 boards meets the §8 budget and respects the viewer's board permissions (a guest must not see numbers from boards they cannot open).

**Phase 6 — CRM / advanced**
`connect_board` (+ `ItemLink`), rollup and formula columns with cycle detection, template gallery (task tracker, CRM, hiring, content calendar, **airport project tracker** — spec below).
*Done when:* the CRM template is created purely from existing primitives — zero CRM-specific tables. Same bar applies to the airport template: zero airport-specific tables.

**Airport project tracker** — full template spec in `docs/templates/airport-project-tracker.md`. It exists as a deliberate stress test of the Phase 6 bar: a real phased-procurement domain (Bidding → Awarded Contract → Operation → Warranty Period) expressed purely as groups, standard column types, and standard automation triggers. If building it requires one new table or one new trigger type, the abstraction has failed and that is the finding — fix the abstraction, don't special-case the template.

### 10.1 Session plan — what to build first

Phases say *what*; this says *in what order to actually sit down and build it*. Ordered by **cost of getting it wrong**, not by what looks like progress. Update the START HERE line at the top after each session.

**Session 1 — Skeleton + tenancy (Phase 0)**
Scaffold, `docker-compose.yml`, Prisma schema for Organization/Workspace/User/membership, NextAuth (both providers), tRPC context with session + tenancy middleware, `requireBoardAccess` with its unit-tested permission matrix, seed script, CI.
*Gate:* a test proving a cross-org request fails. Nothing else ships until this test exists — every later feature inherits this boundary, and retrofitting tenant isolation is a rewrite.

**Session 2 — One vertical slice, one column type**
Board → Group → Item → ColumnValue, with **exactly one** column type (`text`) implemented through the full §4.3 registry interface, rendered in a minimal Table view, editable inline, persisted with shadow projection + ActivityLog + `OutboxEvent`.
*Gate:* the registry interface survives contact with reality. **Do not build seven column types before proving the registry with one** — if the interface is wrong, fixing it across one file is an afternoon; across seven it is a refactor you will avoid doing, and then you live with the wrong interface forever.

**Session 3 — Fractional ranks + drag-to-reorder**
`lib/ordering/` helpers, `rebalanceRanks` job, dnd-kit wiring for items within a group and groups within a board, single-row-update drag, keyboard sensor enabled from the start.
*Gate:* a drag updates exactly one row (assert it in a test, not by eye).

**Session 4 — The 10k-item board, measured**
Extend the seed with the big board, add virtualization, cursor pagination, and the filter→SQL compiler against shadow columns. Measure against §8.
*Gate:* §8 budgets met at 10k items × 3 column types. **Do this before adding more column types.** Sessions 2–4 exist to validate the two decisions that are expensive to reverse — the shadow-column design and fractional ranks. Discovering a flaw here costs days; discovering it in Phase 5 costs the schema.

**Session 5 — Remaining Phase 1 column types**
`status`, `person`, `date`, `number`, `checkbox`, `long_text`. With the registry proven and perf validated, these should be near-mechanical — one file each. If they aren't, the registry interface is still wrong; fix it now rather than adding the seventh.

**Session 6 — Phase 1 close-out**
Board/Group/Item CRUD polish, role enforcement across every procedure, activity feed, Playwright happy path.
*Gate:* Phase 1 *done-when* — you can run a real project on it.

Only then move to Phase 2.

**Two things to resolve before Session 1, because they change scaffolding:**
1. Worker hosting (§2.1) — always-on service vs serverless-cron job table. Affects repo shape and deploy pipeline.
2. Package manager + Node version + exact library majors (§11) — verify current versions rather than assuming; pin them in Session 1.

**Do not start with:** UI polish, dashboards, automations, or a second view type. All three are cheap once the data layer is right and worthless if it isn't.

---

## 11. Conventions

- **Validation:** every tRPC input has a Zod schema; schemas live next to the router and are exported for reuse in forms.
- **Errors:** throw `TRPCError` with a stable `code`; user-facing copy is resolved in the UI layer, not in the server. Log with request id + org id.
- **Server vs client components:** RSC for shell/layout/initial board metadata; client components for anything interactive (grid, editors, drag). Do not mix a tRPC client hook into a server component — hydrate initial data through the router's `prefetch`.
- **Naming:** procedures are `board.list`, `item.create`, `item.setColumnValue`, `automation.run.list` — `resource.action`, dot-namespaced.
- **Transactions:** any mutation that touches more than one row (item + values + activity log) runs in a single `$transaction`.
- **Domain events** are emitted only after the transaction commits.
- **Rate limiting:** see §12 (single shared limiter, not per-route counters).
- **Dates:** store UTC, render in the user's timezone; boards carry a timezone for `date_arrives` automations.
- **Accessibility:** the grid must be keyboard-navigable (arrows, Enter to edit, Esc to cancel) and dnd-kit's keyboard sensor enabled. Retrofitting this is expensive — do it in Phase 1.
- **Versions:** pin exact versions in `package.json` and verify the current major of each library at scaffold time rather than assuming. If a documented API here conflicts with the installed types, the installed types win — and update this file.

---

## 12. Observability & security

**Observability** — a broken automation or a slow board is invisible unless you build for it from Phase 0:
- Structured JSON logs (request id, org id, user id, procedure name) from every tRPC procedure and worker job.
- Error tracking (e.g. Sentry) on both the Next.js app and the worker process — these are separate runtimes and both need reporting configured, not just the app.
- A `/api/health` endpoint checking DB + Redis connectivity, used by the deploy platform and worker host.
- Emit a metric/log line per `AutomationRun` (fired, failed, dead-lettered) — this is what §7's run-history UI reads from; don't let the UI and the alerting diverge onto separate data sources.

**Security** — beyond the tenant-isolation rules already in §1:
- Sanitize all rich text (Updates/comments, item descriptions) server-side before storage and again on render (defense in depth) — this is the main XSS surface given @mentions and pasted content.
- Rate-limit auth, invitations, file upload, CSV import, and any unauthenticated route — one shared limiter (e.g. Upstash Ratelimit) applied as tRPC middleware, not ad hoc per-route counters.
- Validate file uploads by content-type sniffing, not just extension; cap size; scan or at least isolate the S3 bucket from direct public write.
- Secrets (`NEXTAUTH_SECRET`, DB/Redis URLs, S3 keys) live only in the deploy platform's secret store — never committed, never logged, even in debug-level logs.
- Invitations and password-reset tokens are single-use, short-lived, and invalidated on use — test this explicitly, it's a common regression.

---

## 13. Risks & open decisions

**Known risks (mitigate, don't discover later)**
- *Query performance on `ColumnValue`* — mitigated by shadow columns (§4.2); revisit if p75 filter time drifts past budget.
- *Rank precision exhaustion* under heavy reordering — mitigated by the `rebalanceRanks` job; alert if any rank string exceeds ~40 chars.
- *Automation storms* — mitigated by depth limits, dedupe, and per-board concurrency caps on the queue.
- *Scope creep into per-use-case features* — the Phase 6 gate exists specifically to catch this.

**Open decisions** (each needs an owner and a date before it blocks a phase)
| Decision | Blocks | Default if undecided |
|---|---|---|
| Automation worker hosting (§2.1): always-on service vs serverless-cron job table | Phase 4 | Small always-on worker service (Railway/Fly.io) alongside Vercel app |
| Real-time transport (Pusher vs Socket.IO vs Postgres LISTEN) | Post-MVP live updates | Polling + optimistic updates; keep the domain-event bus transport-agnostic so this drops in |
| Multi-tenant billing/plans | Nothing yet | Out of scope until core product works |
| Search (Postgres FTS vs external) | Phase 2 search UX | Postgres full-text over `valueText` |
| Email provider | Phase 3 | Whatever is cheapest to stub locally; keep behind a `mailer` interface |
| Mobile | — | Web-responsive first, native later if needed |
| Live cursors / concurrent editing | — | Post-MVP; last-write-wins per cell with an activity trail |

---

## 14. Decision log

Append one line per architectural decision, newest last. If a decision reverses something above, edit the section **and** log it here.

- `YYYY-MM-DD` — Initial brief: board/column/item polymorphic model chosen over per-use-case schemas.
- `YYYY-MM-DD` — Ordering: fractional string ranks over integer positions (concurrent drag safety, O(1) writes).
- `YYYY-MM-DD` — `ColumnValue`: jsonb canonical value + typed shadow columns for indexable filter/sort.
- `YYYY-MM-DD` — Automations: event-driven worker with depth limit, dedupe key, and `AutomationRun` audit table.
- `YYYY-MM-DD` — Revision: flagged that the BullMQ worker needs an always-on host (not Vercel serverless); added docker-compose for local Postgres/Redis; added §12 Observability & security; added §6.1 Search & import/export.
- `YYYY-MM-DD` — Events: transactional outbox (§7.1) instead of enqueue-after-commit; `OutboxEvent` written from Phase 1 even though the worker arrives in Phase 4.
- `YYYY-MM-DD` — Automation triggers collapsed to four engine types; `status_change` / `person_assigned` become rule-builder presets over `column_changed`.
- `YYYY-MM-DD` — Optimistic concurrency: `version Int` on Item/ColumnValue from the first migration; conflict resolution stays last-write-wins for now.
- `YYYY-MM-DD` — Added §1.1 agent working protocol and §10.1 session plan; extracted the airport template spec to `docs/templates/` to keep this file under the 500-line rule.
- `YYYY-MM-DD` — Added Airport Project Tracker as a Phase 6 template (Bidding → Awarded Contract → Operation → Warranty Period groups), built entirely from existing column types/automation triggers — zero new schema, per the Phase 6 done-when bar.
- `2026-07-23` — Session 1 shipped. Versions pinned (verified live against the npm registry that day): Next 16.2.11, React 19.2.8, TypeScript 6.0.3 (not 7.0.2 — typescript-eslint doesn't support TS 7 yet, downgraded for lint compatibility), Prisma 7.9.0, next-auth 4.24.15 (v5/Auth.js still beta), tRPC 11.18.0, Zod 4.4.3. Auth: Google OAuth + Email magic link (`next-auth`'s Email provider), `PrismaAdapter`. Worker hosting decision (§2.1) recorded as the default — always-on service alongside Vercel — but not built; no BullMQ/queue code exists yet.
- `2026-07-23` — Prisma 7 breaking changes discovered mid-build, now baseline for this repo: the `prisma-client` generator writes plain `.ts` to a custom `output` path (here `generated/prisma`, gitignored) instead of `node_modules/@prisma/client`; `datasource.url` is no longer valid in `schema.prisma` (lives in `prisma.config.ts` instead); `PrismaClient` now requires an explicit driver `adapter` (`@prisma/adapter-pg` + `pg` here) rather than connecting from a schema URL directly. `@auth/prisma-adapter` still types against the default `@prisma/client` export, which has no models under this setup — `server/trpc/auth.ts` casts through `Parameters<typeof PrismaAdapter>[0]` as a documented workaround.
- `2026-07-23` — Tenant isolation (§4.2) implemented as two layers: every service query filters by `organizationId` explicitly (primary), plus a Prisma Client Extension (`server/db/client.ts`) that throws if a query against `Workspace`/`Board` runs inside a request (`AsyncLocalStorage`-tracked tenant context, `server/db/tenantContext.ts`) without a matching `organizationId` — fails loud rather than silently leaking cross-tenant data. The same extension auto-filters `deletedAt: null` on reads.
- `2026-07-23` — `requireBoardAccess` role resolution: a user's org-level `Membership.role` is their default board role, *except* `GUEST`, which never gets default access — guests only gain a board via an explicit `BoardMembership` row (matches §5's "guests only see boards they're explicitly added to"). An explicit `BoardMembership` always overrides the org-level default when present.
- `2026-07-23` — Minimal `Board` + `BoardMembership` models added in Phase 0 (not just Organization/User/Workspace/membership) — `requireBoardAccess` and the §5 role matrix need something board-shaped to resolve against; full Board features (Group/Item/ColumnValue/Views) remain Phase 1+.
- `2026-07-23` — No `prisma/migrations/` committed yet. This sandbox has no Docker/local Postgres, so schema/seed/tests were verified via `prisma db push` against Prisma's local `prisma dev` server instead — `migrate dev`'s shadow-database step isn't wire-compatible with that ephemeral server (unrelated to the schema; ordinary Docker Postgres doesn't have this limitation). **First follow-up before Session 2:** run `docker compose up -d && pnpm db:migrate` once against real Postgres to generate and commit the initial migration; CI currently uses `prisma db push` for its ephemeral test database and should switch to `prisma migrate deploy` once that migration exists.
- `2026-07-24` — Closed the Session 1 follow-up: `docker compose up -d` against real Postgres/Redis, then `pnpm db:migrate --name init` generated `prisma/migrations/20260723233151_init` (first committed migration — CI switched from `prisma db push` to `prisma migrate deploy`, matching the TODO that was already written into `ci.yml`). Also fixed a Prisma 7 config gap found while seeding: `package.json`'s legacy `prisma.seed` key is not read by Prisma 7 (`db seed` errored "No seed command configured"); moved it to `prisma.config.ts`'s `migrations.seed` and removed the dead `package.json` key. Repo's first commit (`479a86e`) made at this point — everything from Session 1 had been sitting uncommitted until now.
- `2026-07-24` — Session 2 shipped: Board→Group→Item→ColumnValue vertical slice with the `text` column type, proving the §4.3 registry interface (`lib/columnTypes/types.ts` needed no changes after implementation — good sign for adding `status`/`person`/etc. in Session 5). New dependency: `fractional-indexing@4.0.0`. Resolved the three things flagged underspecified going in: (1) stood up a minimal `lib/ordering/rank.ts` now (just `firstRank`/`rankAfter`) rather than waiting for Session 3, which extends it rather than creating it fresh; (2) `ActivityLog` shape landed as `{ id, organizationId, boardId, itemId?, actorType, actorId, type, payload, createdAt }`, one row per item-create and per column-value write; (3) `Item.number` is computed transactionally as `MAX(number)+1` scoped to the board, using a `SELECT ... FOR UPDATE` lock on the *Board* row as the serialization point (Postgres won't allow `FOR UPDATE` directly on an aggregate query) — correct but serializes concurrent item-creates per board, acceptable until Session 4's perf work.
- `2026-07-24` — Two Prisma 7 gotchas hit during Session 2, worth knowing before the next schema change: (1) `prisma migrate dev` in this custom-generator-output setup does **not** reliably regenerate `generated/prisma` as part of the same invocation — run `pnpm exec prisma generate` explicitly right after, or typecheck fails with misleading "property does not exist on PrismaClient" errors. (2) `@@index([field], type: Gin)` on a `String[]` column (used for `ColumnValue.valueRefIds` per §4.2) works out of the box on Prisma 7.9.0 with no preview feature flag needed.
- `2026-07-24` — Client-side tRPC gotcha: returning a raw Prisma row with a `Json` field (e.g. `ColumnValue.value`) from a query/mutation makes TypeScript choke ("type instantiation is excessively deep") once it flows through `@trpc/react-query`'s `useQuery`/`useMutation` optimistic-update generics — Prisma's `JsonValue` type is recursive and doesn't survive that generic chain. Fix used here: routers map Json-bearing fields to `unknown` before returning (see `server/services/boards.ts`'s `BoardColumnValue`/`BoardColumnDefinition` types and `item.setColumnValue`'s trimmed return in `server/trpc/routers/item.ts`) rather than returning Prisma rows verbatim. Worth remembering for every future column type with Json-shaped values (`connect_board`, `formula`, etc.).
- `2026-07-23` — Noted for awareness, not acted on: a `CLAUDE.lite.md` also exists in this repo (a simplified single-tenant variant with no Organization layer, no Redis/BullMQ). Session 1 was built against this file (`CLAUDE.md`), per explicit instruction referencing §10.1 (a section that only exists here, not in the lite variant). Flagging in case the two were meant to be reconciled or the lite version was intended as primary.
- `2026-07-24` — Revision: the 2026-07-24 entry above claiming `lib/columnTypes/types.ts` "needed no changes after implementation" turned out to be premature — the registry contract was substantially redesigned (still Session 2, `text` still the only implemented type) after being stress-tested against `person`/`date`/`formula` shapes it hadn't been checked against yet. Five changes, all now reflected in §4.3: (1) `toShadow` takes a `DeriveContext` (value + settings + item + every sibling column/value on the item + board timeZone) instead of `(value, settings)`, so computed types (`formula`/`rollup`) can read dependencies without a second signature later; (2) filter operators moved from per-column-type `filterOperators` to a per-shadow-field `extraOperators` escape hatch over shared sets (`lib/columnTypes/operators.ts`, still Session 4, not built); (3) added `groupKeys(value, settings) -> GroupKey[]` (0..n buckets, not a single string — multi-assignee `person` needs to land in >1 Kanban column, and empty gets its own explicit bucket); (4) added `reconcileValues?` so a column type can migrate/clear `ColumnValue`s in the same transaction as a settings change (e.g. deleting a status option); (5) added `computed?: boolean` so `setColumnValue` can generically reject writes to formula/rollup columns. Also: `Cell`/`Editor` props changed (`Cell` takes `readOnly` instead of owning an `onStartEdit` callback — the grid now owns the click-to-edit trigger; `Editor`'s `onCommit` renamed `onChange`), `defaultValue` became `(settings) => TValue` instead of a constant, `parseFromImport` renamed `parse` and can return `null`. `Board.timeZone String @default("UTC")` added to the schema (new migration `20260724011431_add_board_timezone`) since `DeriveContext.timeZone` needed a real value. `text` was rewritten against the new contract, including `isEmpty`/`groupKeys`/`parse` even though they're near-trivial for a plain string — the point is proving the interface, not minimizing this file.
- `2026-07-24` — Session 3 shipped: `lib/ordering/rank.ts` gained a general `rankBetween(before, after)` (existing `firstRank`/`rankAfter` now sit on top of it, unchanged for callers), `lib/ordering/rebalance.ts`'s `rebalanceRanks({organizationId, scope})` re-spaces a scope's ranks in one transaction (`itemsInGroup` | `groupsInBoard`), and `moveItem`/`moveGroup` services + `item.move`/`group.move` procedures do single-row-update reorders (`Item` checks `expectedVersion` per §4.2; `Group` has no `version` column so it's last-write-wins). New dependencies: `@dnd-kit/core@6.3.1`, `@dnd-kit/sortable@10.0.0`, `@dnd-kit/utilities@3.2.2`, wired into `BoardTable` with `PointerSensor` + `KeyboardSensor` from the start. `rebalanceRanks` is a plain callable function only — nothing schedules it yet, same `OutboxEvent`-style deferral to Phase 4 (BullMQ doesn't exist). No schema migration needed — `rank`/`version` columns already existed from Session 1/2.
- `2026-07-24` — Found mid-Session-3, real not theoretical: a malformed rank string doesn't just cosmetically misorder a drag (as assumed when the plan was approved) — `fractional-indexing`'s `generateKeyBetween` strictly validates its inputs and **throws** on a bad one, so a garbage rank persisted by `moveItem`/`moveGroup` crashes the *next* `rankAfter`/`rankBetween` call against it (e.g. any later sibling insert in that scope). Caught this via a test that reused a corrupted fixture across cases. Fix: `lib/ordering/rank.ts` now exports `isValidRank(rank)` (probes `generateKeyBetween(rank, null)` in a try/catch — the library exports no public validator), and `moveItem`/`moveGroup` reject an invalid rank with `BAD_REQUEST` before writing. Only the rank's *head* (first) character is strictly validated by the library, not the whole string — worth knowing before hand-writing test fixtures or assuming a `.length`/regex check would catch the same cases.
- `2026-07-24` — Session 4 shipped: `board.get` split into a shell query (board/groups/columns) and a new cursor-paginated `item.list` per group (§6: "cursor-based, per group, default 50 items"). Two query shapes depending on sort: default order queries *from* `Item` by `rank`; an explicit column sort queries *from* `ColumnValue` (`where: {columnId, item: {...}}`, `orderBy: {<shadowField>}`) because Prisma can't order a to-many relation by a filtered related record's field — this hits the `@@index([boardId, columnId, valueText])`-shaped index directly instead. Both branches are keyset (cursor = last row's id / `{itemId,columnId}`), not offset-paginated. New: `lib/columnTypes/operators.ts` (shared per-`ShadowField` `FilterOperatorDef` sets — named-but-not-built in CLAUDE.md since Session 2) and `lib/views/{viewConfig,compileQuery}.ts` (the filter→SQL compiler; `viewConfig` matches §6's shape exactly but is a per-request input, not persisted — no `View` model yet, that's §10 Phase 2). `lib/columnTypes/types.ts`'s `SqlFragment` placeholder is now concretely `Prisma.ColumnValueWhereInput`, per that file's own invitation to do so — not a simplification of the fixed contract. New dependency: `@tanstack/react-virtual@3.14.8`.
- `2026-07-24` — Two scope calls made and flagged (not silently), worth remembering: (1) the Session 4 gate text says "10k items × 3 column types" but only `text` exists (Session 5 adds the rest, deliberately *after* Session 4) — proceeded with multiple `text` columns standing in for variety; a fuller multi-type re-measurement is implicitly Session 5's job. (2) The 10k-item seed board is bulk-inserted (`createMany`, pre-generated ranks, no `ActivityLog`/`OutboxEvent`) by explicit user decision — routing it through `createItem`/`setColumnValue` would take minutes-to-tens-of-minutes for synthetic perf-fixture data with no audit trail worth having; every other seed fixture still goes through the service layer. Bulk path took ~16s for 10k items × 5 columns in practice.
- `2026-07-24` — `BoardTable` moved off literal `<table>`/`<tr>`/`<td>` markup to a styled div-grid (`role="table"`/`"row"`/`"cell"`/`"columnheader"` via ARIA, to avoid an accessibility regression per §11) — necessary because TanStack Virtual needs a fixed-height, independently scrollable container per virtualized list, and a `<tbody>` can't be that while keeping one `<thead>` per board. Each group now owns its own capped-height (400px) scroll region, its own `useVirtualizer`, and its own nested `DndContext` (item drags never cross groups, so nested independent `DndContext`s — one per group for items, one at board level for groups — don't conflict; dnd-kit doesn't support drag interactions *spanning* nested contexts, but nothing here needs that). Worth knowing before touching board layout again: it's no longer a real `<table>` DOM structure.
- `2026-07-24` — Session 5 shipped: `status`, `person`, `date`, `number`, `checkbox`, `long_text` — all six landed as genuinely near-mechanical one-file additions against the registry/shadow/filter machinery from Sessions 2–4, which is the actual validation the CLAUDE.md framing was asking for ("if they aren't [near-mechanical], the registry interface is still wrong" — it isn't). Modeling notes for future types: `number`/`date`/`status` use `TValue` including `null` for "no value" (0 is a real number, unlike `text`'s `""` sentinel which doubles as both "empty string" and "no value" — that conflation was fine for `text` but would be wrong for `number`); `person`'s `TValue` is `string[]` with `[]` (not `null`) as empty, matching Decision 3's multi-assignee array framing; `checkbox` reuses `valueNumber` (stored 1/0) rather than adding a 5th `ShadowField` variant for one boolean-valued type.
- `2026-07-24` — Three gaps found while building Session 5's types, deliberately deferred rather than solved or hidden: (1) `status.toShadow` stores the raw `optionId` in `valueText`, so `ORDER BY valueText` sorts alphabetically by id, not by the option's configured `order` — nothing depends on status sort order yet (no Kanban view exists), revisit if/when it does; the alternative (encoding order as a zero-padded prefix into `valueText`) was considered and skipped as unneeded complexity for now. (2) `person`'s `Editor` has no real people-picker — it's a plain comma-separated-user-ids text input. `CellProps`/`EditorProps` have no way to fetch a board's member list, and no `board.listMembers`-shaped query exists; building one is Phase 2/3 UI work, not a registry-interface gap. (3) `date.toShadow` reads `ctx.timeZone` but doesn't use it — a date string is interpreted as UTC midnight regardless of the board's actual timezone, per explicit user sign-off (no date library installed, avoided adding one for a Calendar view that doesn't exist yet). All three are commented in their respective source files, not just here.
- `2026-07-24` — Session 6 shipped (Phase 1 close-out): `board.create`/`rename`/`delete`, `group.rename`/`delete`, `item.rename`/`delete`, `column.rename`/`delete` — before this session the only way to create a board was the seed script calling Prisma directly. `item.rename` carries `expectedVersion` and bumps `Item.version` like `moveItem`/`setColumnValue` (§4.2: every write to Item participates in the optimistic-concurrency contract); `group`/`board`/`column` rename/delete stay last-write-wins (no `version` column, matching the Session 3 precedent). Deliberately asymmetric: `group.create`/`rename` are GUEST-level ("everyday usage," the Session 2 precedent) but `group.delete` is ADMIN — it cascades (soft-deletes every item in the group) and is materially more destructive than creating or renaming one. `deleteBoard`/`deleteGroup`/etc. don't need to cascade-soft-delete their own children beyond what §4.2 already specifies for Group→Item, because `requireBoardAccess`'s own `board.findFirst` already respects `deletedAt` — every procedure touching a deleted board's children fails `NOT_FOUND` before reaching the service layer regardless.
- `2026-07-24` — Real permission bug found during the "role enforcement across every procedure" audit, not a hypothetical: `workspace.list` (sitting since Session 1's placeholder) returned every workspace in the org with zero role check — a GUEST got the full workspace list, directly violating §5 ("Guests never see the workspace sidebar"). Fixed with a new `lib/permissions/requireOrgRole.ts` (`requireOrgRole` throws, `getOrgRole` doesn't — `workspace.list` needs the non-throwing form to return `[]` for a GUEST rather than reject the request outright). Also closed a smaller defense-in-depth gap while in the area: the tenant-isolation extension's `READ_OPS`/`WHERE_OPS` sets (`server/db/client.ts`) didn't include `findFirstOrThrow`/`findUniqueOrThrow`, so those bypassed both the soft-delete filter and the tenant-scoping assertion. Not currently reachable through the tRPC API (every procedure gates through `requireBoardAccess`'s filtered `findFirst` first) but a real gap for any future direct service-layer caller (Phase 4 automations, most likely) — cheap to close now, so it's closed.
- `2026-07-24` — `board.create` auto-creates a starter `Group` *and* a starter `text` `ColumnDefinition`, not just the group as originally planned — discovered mid-session that a board with a group but zero columns has nothing to inline-edit, which the Playwright happy path needs. Same reasoning both times: no "create group"/"create column" UI exists this session, so a freshly created board has to be usable out of the box or the rest of the happy path has no floor to stand on.
- `2026-07-24` — Playwright auth: `authOptions` uses `session: {strategy: "database"}` (confirmed in `server/trpc/auth.ts`), so a session is an opaque `Session` row, not a signed JWT — `tests/e2e/helpers/auth.ts` creates one directly via Prisma for a seeded user and Playwright sets it as the `next-auth.session-token` cookie before navigating. No OAuth flow, no email delivery, no test-only backdoor auth route. This only works because of the database-session choice; if the project ever switches to JWT sessions this helper needs rewriting (mint and sign a JWT with the same secret/encoding NextAuth uses), not just tweaking. The drag-reorder step in the e2e test uses dnd-kit's keyboard sensor (Tab to a `data-testid="drag-handle-*"`, Space/Arrow/Space) rather than simulating mouse-drag coordinates — genuinely tests the same keyboard-accessibility path built in Session 3, and far more reliable to script than crossing `PointerSensor`'s activation threshold with synthetic mouse events. Minimal `data-testid` attributes were added to `BoardTable` rows/cells specifically to make these locators robust rather than positional/text-fragile.
- `2026-07-24` — Known gap surfaced but not fixed this session (flagging for whoever picks up Phase 2 navigation/UI work): there is still no UI to *list* or navigate back to existing boards — the home page only shows workspaces with a "create board" form; the only way to reach a board is the redirect right after creating it (or a known URL). Fine for the Playwright happy path (which creates its own board and never leaves it) but a real usability gap for "a user can run a real project on it" beyond a single session. Not in the approved Session 6 plan, called out here rather than silently expanding scope further mid-session.
- `2026-07-24` — The Playwright happy path found three real, severe bugs on its first real run against an actual browser — none of which typecheck/lint/Vitest/curl smoke-testing had ever caught in five prior sessions, because none of those exercise real Next.js RSC bundling *and* real DOM layout *and* real dnd-kit/TanStack Virtual interaction together. Worth remembering as the reason this test exists at all, not just a checkbox: (1) every `lib/columnTypes/<type>.tsx` file needed `"use client"` — `registry.ts` pulls in all seven unconditionally to build `columnTypeRegistry`, and that registry is imported by `server/trpc/routers/column.ts` (reached from `app/api/trpc/[trpc]/route.ts`), so Next's bundler treats the whole reachable graph as server/RSC space; any column-type file exporting an interactive `Cell`/`Editor` (hooks, or even just an `onChange` handler) without `"use client"` broke the *entire* tRPC API route with a 500, not just that one type. (2) `useVirtualizer`'s `estimateSize` is only a first guess — without wiring `virtualizer.measureElement` as a ref on each row, TanStack Virtual never learns a row's *actual* rendered height, so any row taller than the 36px estimate silently overlapped the next one. (3) The actual severe one: `ItemRow`'s inline `style` object spread the parent's `{transform: translateY(virtualRow.start)}` positioning *before* unconditionally setting `transform: CSS.Transform.toString(dndKitTransform)` — the later key won, so dnd-kit's transform (a no-op string when not actively dragging) silently discarded the virtualizer's positioning on *every* row, stacking them all at the same coordinates. Fixed by giving each system its own CSS property: the virtualizer sets `top` (real layout position), dnd-kit keeps `transform` (visual drag offset only). Two systems both wanting `transform` on the same element is the reusable lesson — check for this explicitly next time virtualization and drag-and-drop are combined on the same row.
- `2026-07-24` — Session 7 shipped (Phase 2, first slice: saved views). New `View` model + `ViewVisibility` enum, migration `20260724051212_add_views`; added to both `TENANT_SCOPED_MODELS` and `SOFT_DELETE_MODELS` in `server/db/client.ts`. `server/services/views.ts` (`createView`/`listViews`/`getView`/`deleteView`) + `server/trpc/routers/view.ts`. No new session plan existed for this in §10.1 (it stops at Session 6) — scope was picked live per Phase 2's own done-when ("a saved view URL is shareable"), deliberately limited to persistence + URL-sharing, not a filter/sort-builder UI.
- `2026-07-24` — Permission split for views reused capability names already sitting unused in `lib/permissions/matrix.ts` since before this model existed: `SHARED` views need `board.editStructure` (ADMIN), `PERSONAL` views need only `view.createPersonal` (GUEST) — `view.create`'s router computes `minRole` from `input.visibility` before calling `requireBoardAccess`, since the router can't know which capability applies until it's seen the input. `getView`/`listViews` hide a `PERSONAL` view from everyone but its creator, ADMIN included (404, not 403 — same anti-probing shape as `requireBoardAccess`); `deleteView` is the one place ADMIN gets an override, justified as board-config cleanup rather than a privacy grant. Worth remembering: "ADMIN can manage board config" and "ADMIN can see everything on the board" are *not* the same rule here — don't assume the former implies the latter for future config-like resources (e.g. a future per-user dashboard layout).
- `2026-07-24` — Same "Json field through react-query generics is excessively deep" TS error from Sessions 2/4 (§14, 2026-07-24 entries above) hit again on `View.config` — same fix, a `trimView` helper in `server/trpc/routers/view.ts` erases `config` to `unknown` before returning from every procedure. Third time this exact issue has appeared for a new Json-bearing model; if a fourth one needs it, worth promoting the trim-at-router-boundary pattern into a shared helper instead of hand-rolling it per router.
- `2026-07-24` — No `rank` column on `View`, unlike every other §4.2 fractional-rank entity — deliberate, not an oversight: §4.2's applicability list ("Group-in-Board, Item-in-Group, ColumnDefinition-in-Board, Widget-in-Dashboard") never named View, and ordering a saved-views list by `createdAt` is sufficient since nothing reorders them yet. Revisit only if a future session adds manual saved-view reordering.
- `2026-07-24` — `View` mutations write no `ActivityLog`/`OutboxEvent`, following the `createColumnDefinition` precedent (board configuration, not board data activity) rather than the `item.create`-style data-mutation pattern that writes both. `view.update`/rename was also deferred entirely this session — create+list+get+delete was enough to prove the persistence+URL-sharing mechanism; editing a saved view's config isn't meaningful yet with no filter/sort-builder UI to construct an interesting one.
- `2026-07-24` — Session 8 shipped (Phase 2, second slice: filter/sort-builder UI). `lib/views/deriveDraftConfig.ts` is the pure, unit-tested core (`RawFilterRow`, `isFilterComplete`, `deriveViewConfig`) — it turns the builder's raw, possibly-incomplete row state into a real `ViewConfig`, silently dropping rows that reference a stale/unknown column or operator, or that don't yet have enough args for their operator's arity, rather than throwing or compiling a broken Prisma predicate (e.g. `valueNumber: { gt: NaN }`). `components/board/FilterSortBuilder.tsx` is a thin UI wrapper around it — matches every prior session's line on this (§9: pure functions get unit tests, Cell/Editor-style components don't).
- `2026-07-24` — `BoardTable` now has a `draftConfig` layered on top of the loaded view's (or default) config — the loaded view is only the *seed*, `draftConfig` is what's actually queried, saved-as, or pushed back via `view.update`. `FilterSortBuilder` is deliberately uncontrolled: it owns its own row-editing state, seeded once from `initialConfig` and never reconciled back to that prop on every render (which would fight a user mid-keystroke); `BoardTable` resets it by remounting via `key={viewId ?? "default"}` when the loaded view changes — the idiomatic React way to say "reset this subtree," not a manual sync effect. Filter/sort edits live-apply (no "Apply" button) — a filter-row change alone is a plain state update, the resulting query-key change is what triggers react-query's refetch.
- `2026-07-24` — `view.update` (deferred in Session 7, built now that there's a UI to make it meaningful) has an asymmetric permission shape versus `deleteView`'s: a `PERSONAL` view can only be updated by its own creator, **not even ADMIN** — consistent with ADMIN not being able to *see* someone else's personal view via `getView` either (an editing override for something you can't even view would be a strange exception). A `SHARED` view follows `deleteView`'s existing "board-config cleanup" framing: creator or ADMIN. Same anti-probing 404 as `getView`/`deleteView` — an ADMIN attempting to update a personal view that isn't theirs gets `NOT_FOUND`, not `FORBIDDEN`, since they can't legitimately know it exists. (A first draft of the integration test asserted `FORBIDDEN` here and was wrong — the service's `NOT_FOUND` is correct and matches the code's own comment; fixed the test, not the service.)
- `2026-07-24` — Two real React Compiler lint errors surfaced while wiring `draftConfig`, both fixed rather than suppressed, both worth knowing for future stateful client components: (1) resetting `draftConfig` from `baseViewConfig` via `useEffect(() => setDraftConfig(baseViewConfig), [baseViewConfig])` is flagged — "calling setState synchronously within an effect" causes an avoidable extra cascading render. Fixed using React's documented "adjust state during render" pattern instead: a mirrored `prevBaseViewConfig` state, compared during the render body itself (`if (baseViewConfig !== prevBaseViewConfig) { setPrevBaseViewConfig(...); setDraftConfig(...) }`) — React bails out and re-renders once before commit, no extra round trip, and the compiler doesn't flag it. (2) `FilterSortBuilder`'s row-id generator originally read `nextRowId.current++` from a `useRef` inside a `useState` lazy initializer — the compiler treats a lazy initializer as render-time code, and reading a ref's `.current` during render is disallowed (refs are for effects/event handlers only). Fixed by dropping the ref entirely in favor of `crypto.randomUUID()` for row ids, used uniformly in the initializer and in the `addFilter` event handler. Worth remembering: a lazy `useState(() => ...)` initializer counts as "render" for compiler-purity purposes, even though it only runs once on mount.
- `2026-07-24` — No per-column-type value picker for filters, deliberately not solved this session: a `status` filter's value input is a plain text box expecting a raw `optionId`, not a dropdown of the column's configured option labels — same class of rough edge Session 5 already flagged for `status.toShadow`'s sort order and `person`'s assignee picker. Building a real per-type value-picker would mean adding a new hook to the §4.3 registry interface (currently fixed, "do not simplify it" per Session 2's own instruction) — a bigger, separate architectural decision, not something to fold into a filter-builder session as a side effect. Revisit if/when a Kanban or dashboard session needs friendlier filter UX badly enough to justify the interface change.
- `2026-07-24` — Session 9 shipped (Phase 2, third slice: Kanban). `server/services/columnValues.ts`'s `setColumnValue` transaction body was extracted into `writeColumnValueInTx(tx, params)` (takes the type inferred from `Parameters<Parameters<typeof prisma.$transaction>[0]>[0]`, not a hand-rolled `Omit<PrismaClient,...>` — the tenant-scoping client extension's dynamic types didn't structurally match a plain `Prisma.TransactionClient`, and this derives from `prisma` itself so it can't drift); `setColumnValue` is now a thin `runWithTenant`+`$transaction` wrapper around it, behavior-identical (existing tests pass unmodified). `moveKanbanItem` (`server/services/items.ts`) is the new combined mutation — one `$transaction`, item rank/version update plus `writeColumnValueInTx`, both `item.moved` and `item.column_changed` event rows (§7 already treats these as separate automation trigger types; collapsing them into one now would mean un-collapsing later for Phase 4). Atomicity is asserted directly in `tests/kanbanMove.integration.test.ts`, not assumed: a stale `expectedItemVersion` leaves the columnValue unwritten, a stale `expectedColumnVersion` leaves the item's rank unchanged — both halves commit or neither does.
- `2026-07-24` — Kanban's "group by" column picker is restricted to `status`/`person` (`lib/views/kanbanGroupKeyValue.ts`'s `isKanbanGroupable`), not every column type, even though every type technically implements `groupKeys()`. The reason is the *inverse*: going from "which bucket was this card dropped into" back to "what value should this column now have" is unambiguous only for these two. `valueForGroupKey(columnKey, currentValue, sourceBucketKey, targetBucketKey)` takes both ends deliberately — `person` needs the source to do a real reassignment (remove Alice, add Bob) rather than blowing away every other assignee, matching Decision 3's multi-bucket framing; `status` ignores the source since it's single-valued. Not promoted to a §4.3 registry hook — only one feature needs this generalization right now, matching the discipline already applied to `extraOperators`/`reconcileValues` (built when more than one type needed them).
- `2026-07-24` — `bucketItemsByGroupKeys` (`lib/views/`) special-cases `status`: it enumerates every option in `column.settings.options`, in configured order, including options with zero items right now, plus one "No value" bucket — closing the sort-order gap Session 5 flagged back when no Kanban view existed to make it matter (an empty status would otherwise never render as a droppable column and become unreachable by drag). `person` still only buckets *observed* values, in first-seen order — there's no board-membership list to enumerate "every possible person" yet, the same gap Session 5 flagged for the people-picker, carried forward rather than solved here.
- `2026-07-24` — Two scope cuts made deliberately, not discovered as gaps afterward: (1) no manual reordering within a Kanban bucket — `KanbanBoard.tsx` uses plain dnd-kit `useDraggable`/`useDroppable`, not `@dnd-kit/sortable`; dropping on a different bucket always appends to its end (`rankBetween(lastItem.rank, null)`), dropping on the same bucket is a no-op. Precise "drop between card A and card B" needs per-card drop targets (a `SortableContext`-per-bucket, dnd-kit's "multiple containers" pattern) — real added complexity for a non-core interaction; the Table view remains the tool for fine-grained manual ordering. (2) Kanban cards are read-only (item name only) — no inline rename, no visible-columns configuration, matching the "MVP is fine, not final UI" precedent from every prior session.
- `2026-07-24` — Real bug found while wiring the Kanban toggle into `draftConfig`, not hypothetical: `FilterSortBuilder`'s `onChange` reported a full `ViewConfig` built via `deriveViewConfig(...)` → `viewConfigSchema.parse({filters, sort})`, which fills in schema *defaults* for every field it wasn't given — including `type`/`groupBy`. Since `BoardTable` was calling `setDraftConfig(fullConfig)` (a replace, not a merge), switching to Kanban and then touching any filter silently reset the view back to `type: "table"`. Fixed by narrowing `FilterSortBuilder`'s `onChange` to report only `{filters, sort}`, with `BoardTable` merging it into `draftConfig` (`setDraftConfig(prev => ({...prev, ...delta}))`). Worth remembering for any future field added to `draftConfig`: a sub-component that "owns" one slice of a shared config object should report a delta, not a whole replacement object, or every future field is one edit away from being silently clobbered by an unrelated component.
- `2026-07-24` — `KanbanBoard.tsx` imports `sortByRank`/`cellKey` from `BoardTable.tsx` (now exported), and `BoardTable.tsx` imports `KanbanBoard` — a function-level circular import between the two files. Confirmed safe in practice (both modules finish evaluating before either component actually renders/calls the other's export, and typecheck/lint/tests/dev all ran clean), but flagging the cycle explicitly here in case a future refactor moves either file and trips over it unexpectedly; the cleaner long-term fix if this becomes painful is hoisting `sortByRank`/`cellKey` into a small shared `lib/`-side helper instead of one board component importing from another.
- `2026-07-24` — **Real production bug found and fixed (Session 9 addendum), not a Session 9 regression**: `item.setColumnValue` and the new `item.moveKanban` both 500'd live with `TypeError: Cannot read properties of undefined (reading 'parse')`. Root-caused before touching any code: a direct Node script calling the service function against real seeded data succeeded (proving the logic itself was correct), the same failure reproduced after a full `.next` wipe + clean process restart and a production `pnpm build && pnpm start` (ruling out a Turbopack dev-cache flake), and — decisively — an isolated `git worktree` checked out at Session 8's last commit (`e10bf5f`), built fresh, failed identically on the unmodified `setColumnValue`. This has been silently broken since at least Session 8; no session since Session 6 exercised a live browser mutation to catch it. Cause: every `lib/columnTypes/<type>.tsx` file is `"use client"` (required for its `Cell`/`Editor` components) and exported one object mixing those components with plain, server-usable logic (`valueSchema`, `toShadow`, `groupKeys`, etc.). Next's RSC bundler wraps *every* export of a `"use client"` file as a client reference once that file is reachable from server code — including non-component exports like a Zod schema — so `columnType.valueSchema` resolved to `undefined` at runtime server-side. This is the *inverse* of the bug Session 6 found (missing `"use client"` broke the whole route); here the directive was present and correct, but a single file can't be "server-safe for its logic" and "client-only for its UI" at the same time.
- `2026-07-24` — Fix: split all 7 `lib/columnTypes/<type>.tsx` files into `<type>.ts` (no `"use client"` — schemas, `toShadow`/`isEmpty`/`groupKeys`/`toDisplayString`/`parse`, and the final `export const <type>Column: ColumnType<...>` assembling those plus `Cell`/`Editor` imported from the sibling client file) and `<type>.client.tsx` (`"use client"` — just `<Type>Cell`/`<Type>Editor`). The only runtime import edge is `<type>.ts` → `<type>.client.tsx`; the reverse direction is `import type` only (erased, no real module cycle). Where a helper is used on both sides (`status.ts`'s `resolveOption`, `person.ts`'s `splitIds`), it's **duplicated** — a 1–4 line function — specifically to avoid a genuine circular import, each copy commented explaining why. `registry.ts`'s `import { textColumn } from "./text"` (and the other six) needed **zero changes** — unambiguous resolution once `text.tsx` no longer exists — and all 7 `*.test.ts` files needed zero changes too, since the exported name/shape (`textColumn`, `statusColumn`, etc.) is identical to before. Verified: 221 tests pass unmodified, a rebuilt server returns 200 for both procedures against the exact requests that previously 500'd, and a real keyboard-driven Kanban drag in the browser persisted correctly across a page reload. Worth remembering for every future column type: the split-file pattern (logic file assembles the object, client file holds only the components) is now the template, not the original single-file-with-`"use client"`-at-the-top shape from Sessions 2–8.
- `2026-07-24` — Session 10 shipped (Phase 2, fourth slice: Calendar), scoped to `date`-only (`timeline` doesn't exist as a column type). `listItemsInDateRange` (`server/services/items.ts`) is the first item-listing query that spans the whole board rather than one Group — `listItemsInGroup` and Kanban's swimlanes are both per-Group by design (Table/Kanban organize by real board Group), but a calendar day cell needs items from every group whose date column lands on that day, so this genuinely couldn't reuse the existing per-Group query. It reuses `compileViewConfig` for any *other* active filters and ANDs in its own date-range condition; no cursor pagination (bounded by the rendered grid already) but a flat `limit` (default 500) as a safety cap, keeping §8's "never load the whole board" true even in a pathological single-day pile-up.
- `2026-07-24` — `lib/views/calendarGrid.ts`'s `getMonthGrid(year, month)` is pure date math (Sunday-start weeks, 0-indexed month matching `Date.prototype.getMonth()`), unit-tested against concretely-verified calendar facts (computed via a throwaway `node -e` script rather than hand-derived weekday arithmetic, to avoid a wrong "known fact" corrupting the fixtures) — a month needing exactly 4 rows (Feb 2026, starts and ends on grid boundaries), 5 rows (Feb 2028 leap year, Jan 2026, Dec 2026→Jan 2027 rollover), and a full 6 rows (Jan 2000). **The query range passed to `listItemsInDateRange` is the rendered grid's actual bounds, not the calendar month** — a grid always shows full Sun–Sat weeks, so it commonly includes a few days from the adjacent month; querying only the "true" month would make an item due on one of those visually-present padding days mysteriously not show up. Grid rows are NOT padded to a fixed 6 — a month that fits in 4 or 5 weeks queries a correspondingly smaller (cheaper) range.
- `2026-07-24` — The Calendar "Date column" picker (`BoardTable.tsx`) filters by `getColumnType(registry, c.key).shadowField === "valueDate"`, not a hardcoded list of column keys — a deliberate contrast with Kanban's `isKanbanGroupable`, which *had* to hardcode `["status", "person"]` because it needed a real inverse mapping (bucket → value) that only those two types have. Calendar is read-only, so no inverse is needed — any column type sharing the `valueDate` shadow field (a future `timeline` type included) works automatically, no Calendar-side code change required when one is added. Worth reaching for this shadow-field-based restriction pattern by default for any future column-type-restricted picker; only fall back to a hardcoded key list (like Kanban's) when the feature genuinely needs per-type behavior beyond the shared shadow field.
- `2026-07-24` — Three scope cuts made deliberately for Calendar, matching the "flag rather than silently assume" discipline every prior session has used: (1) read-only — no drag-to-reschedule (unlike Kanban, §6 never says Calendar drags should mutate anything, and Table view's inline `date` editor already covers rescheduling); (2) no "unscheduled items" list — an item with no value for the chosen date column simply doesn't appear, consistent with a calendar being date-indexed by definition; (3) `currentMonth` (which month is displayed) is local `CalendarBoard` component state, not part of the persisted `ViewConfig` — a saved Calendar view remembers *which date column* to use (`dateColumnId`, already reserved in the schema since Session 4) but always opens on the current month, never "whichever month happened to be open when it was saved." Also still inherits `date.ts`'s existing UTC-midnight-not-board-timezone simplification (flagged since Session 5) — Calendar reads the same `valueDate` shadow column and doesn't change that behavior.
- `2026-07-24` — Session 11 shipped: `dropdown` and `timeline` column types, closing out Phase 2's named §4.3 list. `dropdown` is single-select (`TValue = string | null`), `valueText`-shadowed, same option-set settings shape as `status` (`{id,label,color?,order}[]`) — structurally near-identical to `status`, matching how `long_text` already relates to `text` ("functionally identical, the only real difference is presentational/semantic"). `timeline` is `{start, end}` (both ISO dates, Zod-refined so `end >= start`), `valueDate`/`valueDateEnd`-shadowed — `ColumnValue.valueDateEnd` has existed in the schema since Session 1 specifically for this, unused until now. Neither type needed any change to `operators.ts`, `compileQuery.ts`, `viewConfig.ts`, or any router/service file — both slot entirely into existing shadow-field machinery, which is the actual proof the Sessions 2–9 registry design holds up under a second real stress test (the first being Session 5's original six).
- `2026-07-24` — Generalized `lib/views/kanbanGroupKeyValue.ts`'s `isKanbanGroupable`/`valueForGroupKey` from a hardcoded `["status", "person"]` column-key list to branching on **`shadowField`** (`valueText` vs `valueRefIds`) instead. `dropdown` becomes Kanban-groupable with zero new code — it falls straight into the same `valueText` branch `status` already used. This follows the exact bar Session 9 itself set for generalizing ("once more than one type needs it," used to justify not building a registry hook for a single-feature need) — `dropdown` is the second `valueText` type needing this, so the threshold is met. Call sites (`BoardTable.tsx`'s Group-by picker, `KanbanBoard.tsx`'s `handleDragEnd`) now pass the resolved column's `shadowField` instead of its `key`. `bucketItemsByGroupKeys.ts`'s "enumerate every configured option, even empty ones" special case was extended to `"status" || "dropdown"` explicitly (not shadowField-generalized) — "has an exhaustive `settings.options` list" isn't part of the registry's type contract the way `shadowField` is, so this stays an explicit key check on purpose.
- `2026-07-24` — Real integration gap found and fixed while wiring `timeline` into Calendar (not hypothetical): `CalendarBoard.tsx`'s day-bucketing loop only ever handled a plain date *string* value (`date`'s canonical shape) — `typeof value.value !== "string"` silently skipped anything else. Since Calendar's "Date column" picker was already generalized in Session 10 to `shadowField === "valueDate"` (not a hardcoded key list), it would offer a `timeline` column as a valid choice, and selecting one would render a silently-empty grid — no error, just nothing there, because `timeline`'s value is `{start, end}`, not a string. Fixed with a small `dayKeyForDateValue(value)` helper that reads either a plain string or a `{start, ...}` object; a `timeline` item now shows correctly on its *start* day. Full multi-day span rendering across grid cells is still out of scope — flagged, not solved, deferred to a future Gantt-focused session (§6 already separates Calendar from Gantt for this exact reason).
- `2026-07-24` — Observed during Session 11's manual browser verification, not just a theoretical consequence: generalizing `isKanbanGroupable` to `shadowField` (see above) means Kanban's "Group by" picker now also lists plain `text`/`long_text` columns, not just `status`/`person`/`dropdown` — any `text` column shares `status`/`dropdown`'s `valueText` shadow field, so it passes the same check. Grouping by free text creates one Kanban bucket per distinct string value (e.g. one per task name), which is unusual but not incorrect — matches how filtering/sorting already permit "unusual" choices on any column. Accepted, not fixed: restricting the picker further would mean re-introducing a curated key list, undoing the generalization this session was built on. Verified live: Priority (`dropdown`) correctly showed all three configured options as buckets (including the two with zero items) with their colors, and a real keyboard drag moved a card between buckets and persisted after reload.
