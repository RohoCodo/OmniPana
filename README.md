# OmniPana Bar Inventory Pilot

A Next.js + Prisma application for auditable bar inventory operations with photo-assisted counts, invoice receiving review, transfer tracking, POS imports, reconciliation, and monthly reporting.

## Implemented Core Capabilities

- Multi-location, organization-scoped inventory data access.
- Product catalog with bottle sizes, unit cost, par levels, and normalized matching.
- Immutable movement ledger including:
	- INITIAL_COUNT
	- RECEIVING
	- SALE_CONSUMPTION
	- WASTE
	- MANUAL_ADJUSTMENT
	- TRANSFER_IN
	- TRANSFER_OUT
	- PHYSICAL_COUNT (observation records)
- Transfer workflow with same-org enforcement, inventory sufficiency checks, and idempotent linked movement posting.
- Photo-assisted count review and confirmation:
	- AI suggestions are review-only.
	- Confirmation creates physical observations.
	- Photo confirmations now auto-create finalized count sessions with linked lines.
- Count session lifecycle and corrections:
	- DRAFT -> IN_PROGRESS -> SUBMITTED -> REVIEWED -> FINALIZED / VOIDED
	- Finalized lines are non-editable.
	- Corrections create before/after audit rows and additional physical/ledger records.
- Role-based authorization for sensitive actions:
	- Manager-only invoice approval.
	- Manager-only count session review/finalization/void and finalized-count corrections.
- Invoice extraction + reviewed receiving posting (no auto-post before confirmation).
- POS import pipeline with idempotency controls and duplicate conflict protection.
- Monthly reconciliation report endpoint with JSON and CSV output.

## Tech Stack

- Next.js 16, React 19, TypeScript
- Prisma ORM + PostgreSQL schema
- Vitest + PGlite for integration tests
- TailwindCSS 4

## Project Setup

1. Install dependencies:

```bash
npm install
```

2. Configure environment variables (at minimum):

- DATABASE_URL
- AUTH_SECRET
- Optional AI/storage:
	- OPENAI_API_KEY (or DEMO_MODE=true)
	- STORAGE_PROVIDER, STORAGE_BUCKET (if using S3)

3. Generate Prisma client:

```bash
npm run db:generate
```

4. Apply migrations (if using migration deployment flow):

```bash
npm run db:migrate
```

5. Start development server:

```bash
npm run dev
```

## Validation Commands

- Typecheck:

```bash
npm run typecheck
```

- Lint:

```bash
npm run lint
```

- Tests:

```bash
npm test
```

- Build:

```bash
npm run build
```

## Count Sessions API

Endpoint: `POST /api/count-sessions`

Operations:

- `create`
- `upsert-line`
- `transition`
- `correct`
- `get`

Notes:

- `FINALIZED` sessions post physical observations and PHYSICAL_COUNT ledger rows.
- Corrections are only allowed on finalized sessions and are fully auditable.

## Monthly Report API

Endpoint: `GET /api/reports/monthly`

Query parameters:

- `start` (required, ISO date or timestamp)
- `end` (required, ISO date or timestamp)
- `locationId` (optional; defaults to first location for user org)
- `format` (optional: `json` or `csv`, default `json`)

Examples:

- JSON:

```text
/api/reports/monthly?start=2026-01-01&end=2026-01-31&format=json
```

- CSV:

```text
/api/reports/monthly?start=2026-01-01&end=2026-01-31&format=csv
```

## Variance/Reconciliation UI

The Variance screen now supports period export controls for monthly reconciliation data:

- Open JSON report
- Download CSV report

## Migrations

Migration artifacts are stored in:

- `prisma/migrations/20261012121500_init/migration.sql`
- `prisma/migrations/migration_lock.toml`

## Testing Coverage Added

- Transfer semantics and cutoff behavior
- Transfer idempotency and insufficient-stock rejection
- Count session lifecycle transitions and finalized correction audits
- Monthly report arithmetic and CSV generation
- Photo confirmation linkage to finalized count sessions

## Current Known Gaps (Post-Implementation)

- Role model is currently MANAGER/STAFF with targeted enforcement on sensitive actions; broader fine-grained role and policy controls are still pending.
- Batch cocktail production/yield model remains pending.
- Some advanced acceptance edge cases from the pilot spec remain to be added.

## Workspace Notes

- Demo mode is active when `DEMO_MODE=true` or `OPENAI_API_KEY` is missing.
- AI output is always treated as a suggestion until reviewed and confirmed.
