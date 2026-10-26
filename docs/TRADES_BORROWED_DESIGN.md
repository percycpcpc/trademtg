# TradeMTG — Finished trades + borrowed ledger: design contract

Source: gpt-6-astra doc-only plan pass, 2026-10-26. The run executed under a read-only sandbox that rejected the doc write, so this file was recovered verbatim from the pass's final message (`codex-plan-trades-output.txt`); the per-section prose (data-model blocks, API JSON, UI spec, phased plan) was not persisted. The numbered decisions table below — the owner-facing contract — is complete. Build briefs for gpt-5.6-sol derive from this table plus the LOCKED section of `SPEC.md`.

Provenance: every recommendation cites the as-built files it was grounded in. `(inferred)` marks non-cited reasoning.

## Decisions-for-owner table (recommendations pending owner Go)

| # | Decision | Options | Recommendation and reasoning |
|---|----------|---------|------------------------------|
| 1 | Undo completion | Revert / no undo | **No undo in v1.** Revert deletes locked history and can overrestore quantities after capped deduction or re-import (`SPEC.md`, `app/api/[...path]/route.ts`). |
| 2 | Tab deep links | Local state / `?tab=` | **Yes.** Preserve tabs through member switches and canonical redirects (`app/ui.tsx`, `app/[name]/page.tsx`). |
| 3 | Both-party Mark done | Owner controls / shared summary / inbox | **Shared accepted-summary on the buyer's wantlist.** Sellers already see it while OfferEditor is hidden (`app/ui.tsx`). |
| 4 | Payment settlement | Offer-only / Trade ID / separate debt flow | **Trade-ID paid toggle**, with offer alias through durable `sourceOfferId`. Same action settles later; offers can cascade away (`prisma/schema.prisma`). |
| 5 | Listing shape | Embedded / separate endpoints | **Separate Trades and Borrowed endpoints.** Preserve the gallery snapshot contract (`lib/server.ts`). |
| 6 | History size | Unlimited response / cap / pagination | **Cursor pagination: 50 default, 100 maximum, no lifetime cap.** History grows indefinitely (inferred from `SPEC.md`). |
| 7 | Duplicate-card loans | Unique card / independent loans | **Allow multiple outstanding loans**, including identical parties and card (`SPEC.md`). |
| 8 | Empty states and entry | Quiet link / primary button | **One primary Add borrow**, section-specific empty copy, existing explicit-create dialog pattern (`app/ui.tsx`). |
| 9 | History survival | Cascade / nullable members / restrict | **Offer SetNull; Member Restrict**, with friendly deletion conflict. Existing cascades otherwise erase history (`prisma/schema.prisma`). |
| 10 | Repeat seller after partial finish | Recycle / block / partial uniqueness | **New offer with non-done partial uniqueness.** Current unconditional uniqueness prevents this (`prisma/schema.prisma`). |
| 11 | Done and sibling semantics | Sketch unchanged / explicit guards | **Explicit open/accepted filters and done guards.** Oversized sibling offers require correction before acceptance (`app/ui.tsx`, `app/api/[...path]/route.ts`). |
| 12 | Concurrency scope | Viewer / actor / buyer or borrower | **Buyer revision for trades; borrower revision for loans**, route-bound receipts and fresh transactional reads (`lib/server.ts`, `app/use-list.ts`). |
| 13 | Debt persistence | Duplicate Borrow / derived Trade | **Derive debt from `paidAt = null`.** Settlement removes it from Borrowed while preserving Trades history (`SPEC.md`). |
| 14 | Snapshot details | Sketch only / expanded snapshot | **Include printing, finish, actual deducted quantity, and durable source offer ID** (`prisma/schema.prisma`). |
| 15 | Loan permissions and editing | Party-only / any actor; edit / toggle | **Any selected actor logs/toggles; distinct parties; whole-row returns; no term editing/deletion** (`SPEC.md`, `app/api/[...path]/route.ts`). |
| 16 | Zero-price and self trades | Normalize / preserve choice / reject | **Keep payment choice at HK$0; reject new self-offers and self-completion.** Existing self-offers can be cleared (`app/ui.tsx`, `app/api/[...path]/route.ts`). |
| 17 | Autosave and drafts | Immediate creation / explicit creation | **Explicit borrow creation and finish confirmation; toggles autosave.** Reconcile stale quantity drafts after completion (`app/ui.tsx`, `app/use-list.ts`). |
| 18 | As-built contradictions | Follow sketch / follow repository | **Use `app/ui.tsx`, `app/use-list.ts`, pinned Prisma 6.19; split enum migration, preserve manual indexes, gate startup on migration success** (`app/[name]/page.tsx`, `package.json`, `docker-entrypoint.sh`). |

## Notes for the build brief (K3)

- Row 1 overrides the SPEC open item: spec recommended a Revert action; astra recommends **no undo in v1** — owner decides.
- Row 9 changes the SPEC sketch's `Trade.offerId @unique` FK: offers get `SetNull` (not cascade) so history survives offer lifecycle; members get `Restrict` with a friendly conflict message.
- Row 10 implies a hand-written partial unique index (repo precedent: the accepted-offer partial unique index) allowing multiple open offers per `(wantId, offererId)` only when no non-done offer exists — exact shape is a build-pass detail.
- Row 18's "split enum migration" = the `OfferStatus` + `done` enum change must ship as its own migration before the table additions.
