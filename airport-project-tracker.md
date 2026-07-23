# Template — Airport Project Tracker

> Phase 6 template spec. Referenced from `CLAUDE.md` §10 Phase 6.
> Purpose: prove the "board template, not new schema" rule against a real domain.
> **Acceptance bar: this template adds zero Prisma models.**

Validates the "board template, not new schema" rule against a real domain (procurement/infrastructure delivery for airport systems — RSMS, A-VDGS, AMS, PBB-class projects). Built entirely from existing primitives:

- **Groups (4, fixed order, seeded by the template):** `Bidding` → `Awarded Contract` → `Operation` → `Warranty Period`. An item moves group-to-group as the project progresses — this *is* the phase, no separate "phase" table needed.
- **Columns (all standard types from §4.3, no new column type required):**
  | Column | Type | Notes |
  |---|---|---|
  | Reference No. | `text` | e.g. AOT ref number |
  | System type | `dropdown` | RSMS / A-VDGS / AMS / PBB / other — option set, not free text |
  | Bid submission date | `date` | |
  | Contract award date | `date` | drives the Bidding → Awarded Contract automation below |
  | POC / qualification score | `number` | |
  | Warranty tier | `dropdown` | |
  | Warranty expiry | `date` | drives the Phase-6 warranty-reminder automation |
  | Responsible person | `person` | |
  | TOR / spec document | `link` or `files` | |
- **Automations shipped with the template (built on the §7 trigger/action set, no new trigger types):**
  1. `column_changed(Contract award date, not-null)` → `move_group(Awarded Contract)`.
  2. `date_arrives(Warranty expiry − 30 days)` → `notify(Responsible person)`.
  3. `column_changed(Group → Operation)` → `create_item` (commissioning/acceptance-test checklist item in the same group).
- **Dashboard widgets (standard chart/number types from §Phase 5, no new widget type):** count-by-status widget (projects per phase), and a "days to warranty expiry" table widget sorted ascending.
- *Done-when check specific to this template:* deleting the template definition removes zero Prisma models — everything it needs already exists from Phases 1–5.

