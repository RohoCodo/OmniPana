# Ahara Pilot Gap Matrix

Date: 2026-10-12

## Scope

Audit and Phase 1 implementation status for the Ahara inventory pilot requirements against this repository.

## Requirement Coverage

| Area | Status | Notes |
| --- | --- | --- |
| Tenant-scoped access | Implemented | Server-side organization/location authorization is enforced before inventory, imports, receiving, and photo operations. |
| Product catalog basics | Implemented | Product setup includes normalized name, brand, category, bottle size, unit cost, and par level. |
| Multi-location model | Implemented | Locations exist and are organization scoped. |
| Immutable movement ledger | Partial | Inventory movements are persisted as transactions with source/idempotency metadata, but some advanced movement classes from spec are still missing. |
| Transfer workflow (linked out/in) | Implemented | Added transfer service + API + UI flow posting linked TRANSFER_OUT/TRANSFER_IN records with idempotency. |
| Transfer net-zero venue semantics | Implemented | Tests validate source decreases, destination increases, and no duplicate reposting. |
| Opening counts | Implemented | Initial count workflow supports full and partial bottles. |
| Physical count sessions with full lifecycle statuses | Implemented | Added count session model and transitions (draft/in_progress/submitted/reviewed/finalized/voided) with auditable corrections. |
| Receiving/invoice review before posting | Implemented | Invoice extraction requires review/confirmation before posting movements. |
| Duplicate invoice detection | Implemented | Duplicate vendor + invoice checks are present and tested. |
| POS import idempotency | Implemented | Import hash and external-id conflict handling are tested. |
| Unmapped POS exception queue | Partial | Mapping validation exists and monthly reporting now discloses unmapped sales counts/quantity, but a dedicated exception queue workflow is still limited. |
| Recipe depletion | Implemented | Recipe-based consumption posting exists with tests. |
| Batch cocktails/keg production model | Missing | No full batch production/yield/inventory model yet. |
| Photo suggestions separate from verified counts | Implemented | AI outputs are reviewed; confirmations are explicit and auditable. |
| Costing policy transparency (weighted/latest config) | Partial | Unit-cost valuation exists; configurable costing policy and historical cost basis are not fully modeled. |
| Monthly reconciliation report export | Implemented | Added monthly report API with JSON/CSV output and explicit movement/expected/physical/variance fields. |
| Role-based restrictions on sensitive actions | Implemented | Manager-only enforcement now covers invoice approval, count review/finalize/correction, transfers, and manual/waste adjustments. |
| Edge-case acceptance tests (full list) | Partial | Strong coverage exists for imports/receiving/photos and basic arithmetic; many spec edge cases remain to be added. |

## Changes Implemented In This Pass

1. Added transfer operation in inventory service:
   - Validates same-org locations, matching bottle size, positive quantity, sufficient source inventory.
   - Creates linked TRANSFER_OUT and TRANSFER_IN ledger entries atomically.
   - Uses deterministic idempotency keys and shared transfer source ID.
2. Added transfer action to API actions route.
3. Added transfer UI section in product detail page.
4. Expanded workspace payload to include organization locations for transfer destination selection.
5. Added tests:
   - Unit ledger tests for transfer net-zero semantics and cutoff exclusion behavior.
   - Integration tests for transfer posting idempotency and insufficient-balance rejection.
6. Hardening fixes discovered during validation:
   - Ledger helper now safely handles both Prisma Decimal and string test values.
   - Removed conflicting wildcard exports in inventory barrel to satisfy type checking.
7. Added count session backend workflow:
   - New Prisma models for count sessions, lines, and corrections.
   - New API endpoint for create/upsert-line/transition/correct/get operations.
   - Finalization posts auditable physical-count and ledger entries once, with idempotent behavior.
8. Added monthly report export API:
   - New endpoint with `start`, `end`, optional `locationId`, and `format=json|csv`.
   - Includes opening, period movements, expected ending, physical ending, and variance values.
9. Added test coverage:
   - Count session lifecycle and correction tests.
   - Monthly report arithmetic and CSV generation tests.
10. Added role-restriction enforcement and tests:
   - Manager-only invoice confirmation.
   - Manager-only count-session review/finalize and finalized-count corrections.
   - Manager-only transfer posting and manual/waste inventory adjustments.
11. Extended monthly report transparency:
   - Added disclosure metrics (unreviewed invoices, unmapped sales rows/quantity, missing cost rows, low-confidence counts).
   - Added variance-page summary UI so disclosure metrics are visible before export.

## Validation Run

- Typecheck: pass
- Lint: pass with one existing warning (unused eslint-disable directive in lib/prisma.ts)
- Unit/integration tests: pass
- Full test suite: pass
- Production build: pass

## Remaining Phase 1 Priorities

1. Expand test coverage to include more required edge cases from the spec (returns/credits, modifier-specific depletion, cross-cutoff warnings, role restrictions, concurrency collisions).
2. Clarify and implement explicit costing policy selection/labeling beyond latest unit cost.
3. Add stronger exception queues for unresolved POS mappings and unresolved invoice lines in UI reporting.
4. Implement batch cocktail production/yield and serving-time addition depletion model.
