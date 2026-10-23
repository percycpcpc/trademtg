# TradeMTG implementation plan

Planning only, 21 October 2026. No application, migration, or deployment is created by this document. The model definitions below are the implementation specification. Locked requirements take precedence over recommendations; the final numbered table collects the remaining product choices for batch approval.

Authority: [SPEC.md](../SPEC.md), particularly **Owner decisions (LOCKED)**, **Gallery UX contract**, **Data model (sketch)**, **API shape (sketch)**, and **Open items for the plan**. Section citations below use these exact section names. Technical references were checked during planning; Scryfall's endpoint documentation returned HTTP 403 to the research tool, so endpoint contract probes remain an explicit implementation gate.

## 1. IA & pages

| Route | Purpose and actions |
| --- | --- |
| `/` | Pick your name, or add a member inline. Selecting a member establishes the acting identity and opens their gallery. Remember the member ID locally; validate it on return. |
| `/[name]` | One member's wantlist gallery. Header separates “Acting as” from “Viewing list”; switching the viewed list never silently changes identity. Compact member switcher, import/add/export controls on your own list, gallery, total footer. |
| `/[name]?want=<wantId>` | Same gallery with an accessible dialog/sheet open. Owner gets quantity management, removal and offer selection; another member gets the offer form and existing offers. No card-detail navigation. Query state is optional deep-link restoration, not a separate page. |
| `/[name]?panel=import` | Paste, review results and repair unknowns in a sheet on the gallery. Closing restores the grid and focus. |

**An all-lists overview is not worth building for v1.** Ten members can be served by the picker and compact switcher; a second gallery adds ambiguity about whose wants are being offered against. This follows the owner's lean in SPEC **Open items for the plan**, while retaining per-person lists required by **Owner decisions (LOCKED) §1**.

Names: trim, normalize Unicode NFC and collapse whitespace; 1–40 characters. Store a case-folded `nameKey` to prevent visually equivalent case duplicates. Encode the display name as one URL segment; reject `/`, `\\`, control characters and reserved routes (`api`, `_next`, `favicon.ico`, `robots.txt`, `sitemap.xml`). Resolve case-insensitively and redirect to canonical spelling. No rename UI in v1. Missing member: useful not-found view with picker. Direct visitors may browse; first mutation opens the member picker inline. Identity is a trust convention, not authentication. Acting-owner and acting-offerer checks are still enforced against submitted member IDs, without pretending those IDs prove identity. Anyone can delete anything through an inline confirmation, as locked in **Owner decisions §5**.

## 2. Prisma schema

Use Next.js 15, matched Prisma CLI/client versions in the 6.x line (`^6.6`, committed lockfile), and Postgres. Never follow Prisma 8 examples: current unversioned documentation already redirects to v8. These definitions use Prisma 6 syntax. Sources: SPEC **Owner decisions §6**, **Data model (sketch)**; [Prisma v6 transactions](https://www.prisma.io/docs/orm/v6/prisma-client/queries/transactions).

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

enum OfferStatus {
  open
  accepted
  withdrawn
}

enum ImportLineState {
  unresolved
  resolved
  ignored
}

model Member {
  id        String   @id @default(uuid()) @db.Uuid
  name      String   @unique @db.VarChar(40)
  nameKey   String   @unique @db.VarChar(160)
  color     String   @db.VarChar(7)
  revision  Int      @default(0)
  createdAt DateTime @default(now()) @db.Timestamptz(3)
  wants     Want[]
  offers    Offer[]
  imports   ImportBatch[]
  receipts  MutationReceipt[]
}

model Want {
  id          String   @id @default(uuid()) @db.Uuid
  memberId    String   @db.Uuid
  scryfallId  String   @db.Uuid
  cardName    String
  imageUrl    String?
  setCode     String   @db.VarChar(16)
  collectorNo String
  rarity      String
  colors      String[] @default([])
  qty         Int
  createdAt   DateTime @default(now()) @db.Timestamptz(3)
  updatedAt   DateTime @updatedAt @db.Timestamptz(3)
  member      Member   @relation(fields: [memberId], references: [id], onDelete: Cascade)
  offers      Offer[]

  @@unique([memberId, scryfallId])
}

model Offer {
  id           String      @id @default(uuid()) @db.Uuid
  wantId       String      @db.Uuid
  offererId    String      @db.Uuid
  qty          Int
  unitPriceHkd Decimal     @db.Decimal(12, 2)
  status       OfferStatus @default(open)
  createdAt    DateTime    @default(now()) @db.Timestamptz(3)
  updatedAt    DateTime    @updatedAt @db.Timestamptz(3)
  want         Want        @relation(fields: [wantId], references: [id], onDelete: Cascade)
  offerer      Member      @relation(fields: [offererId], references: [id], onDelete: Cascade)

  @@unique([wantId, offererId])
  @@index([offererId])
}

model ImportBatch {
  id          String       @id @default(uuid()) @db.Uuid
  memberId    String       @db.Uuid
  requestId   String       @db.Uuid
  contentHash String       @db.VarChar(64)
  createdAt   DateTime     @default(now()) @db.Timestamptz(3)
  member      Member       @relation(fields: [memberId], references: [id], onDelete: Cascade)
  lines       ImportLine[]

  @@unique([memberId, requestId])
}

model ImportLine {
  id                 String          @id @default(uuid()) @db.Uuid
  batchId            String          @db.Uuid
  lineNo             Int
  rawText            String
  parsedName         String?
  qty                Int?
  setCode            String?
  collectorNo        String?
  reason             String?
  state              ImportLineState @default(unresolved)
  resolvedScryfallId  String?         @db.Uuid
  batch              ImportBatch     @relation(fields: [batchId], references: [id], onDelete: Cascade)

  @@unique([batchId, lineNo])
}

model MutationReceipt {
  id          String   @id @default(uuid()) @db.Uuid
  memberId    String   @db.Uuid
  requestId   String   @db.Uuid
  payloadHash String   @db.VarChar(64)
  response    Json
  createdAt   DateTime @default(now()) @db.Timestamptz(3)
  member      Member   @relation(fields: [memberId], references: [id], onDelete: Cascade)

  @@unique([memberId, requestId])
}
```

`Member.revision` represents the complete list snapshot, including its offers and import repair queue. `MutationReceipt.memberId` is the affected list owner, not the actor. No separate Wantlist model is needed: the member-to-wants relation is the single list. One offer row per offerer/want allows multiple different offerers; withdrawing retains the row, and re-offering reopens it. `resolvedScryfallId` is provenance, deliberately not a foreign key to Want: deleting a want must not reset a consumed import line. Never create a Want with a null/fake Scryfall ID. Unknowns are accepted durably as visible ImportLines, satisfying **Owner decisions §4** without corrupting card identity.

The handwritten Prisma 6 migration must additionally create these database constraints (Prisma 6 schema syntax alone does not express the partial index):

- Unique partial index on `Offer(wantId) WHERE status = 'accepted'`. Do **not** use `@@unique([wantId, status])`, which would also forbid multiple open offers. The partial index is the final at-most-one-accepted guarantee even if a handler has a bug. [Postgres partial indexes](https://www.postgresql.org/docs/current/indexes-partial.html).
- CHECKs: Want and Offer qty between 1 and 9999; `unitPriceHkd >= 0`; revision nonnegative; ImportLine qty either null or 1–9999; color matches six-digit hex. Application validation also rejects more than two monetary decimal places before Postgres could round them.
- Composite unique indexes above already cover member-list, want-offer and batch-line lookups by their leftmost columns. Offerer index supports member deletion and “my offers.” No index on every display field is needed for this scale.

Deleting a want cascades its offers. Deleting an offer removes it even if accepted and immediately reopens sibling availability. Deleting a member cascades their wants, those wants' offers, their offers on other lists, imports and receipts; the confirmation spells out these effects. In the member-delete transaction, increment revisions of surviving lists losing an offer. Deleting unresolved lines is a state change to `ignored`, keeping repair provenance. No soft-deleted wants, auth tables, delivery/payment state, price history, or JSON card catalog.

### Exact accept-offer transaction

Request includes `actorMemberId`, `expectedRevision`, `expectedAcceptedOfferId` (UUID or null), and `requestId`. An explicit replacement supplies the currently accepted ID; the ordinary first acceptance supplies null. This refines **API shape (sketch)** (“transaction unaccepts siblings”) without silently overwriting another owner's browser action.

1. Resolve the offer's want/list IDs; start a Prisma 6 interactive `$transaction` at Serializable isolation. Lock the owning Member row with parameterized `SELECT … FOR UPDATE`, then lock/re-read the Want and its offers. Revalidate all foreign rows after acquiring locks. All list writers use this same parent-first order; multi-list deletes lock Member IDs in sorted order, then wants/offers in sorted order. Resolve Scryfall data before opening any transaction.
2. Check the receipt under `(listOwnerId, requestId)` first: identical payload hash returns its committed response, even if revision has since advanced; different payload returns `409 IDEMPOTENCY_KEY_REUSED`. A replay returns its original revision; the UI re-fetches the current snapshot afterward.
3. Require actor to equal want.memberId (`403 OWNER_REQUIRED`); require expected revision to match (`409 STALE_LIST`). Require target open or already accepted, never withdrawn (`409 OFFER_WITHDRAWN`), and quantity within current want qty (`422 OFFER_QTY_EXCEEDS_WANT`).
4. Read current accepted offer. If it is already the target, return current snapshot as an idempotent no-op and record receipt. Otherwise require its ID/null to equal `expectedAcceptedOfferId`; mismatch gives `409 ACCEPTANCE_CHANGED` with current accepted ID. A different accepted offer is replaceable only through the explicit replacement request.
5. Update the existing accepted sibling to `open` first, then target to `accepted`, within the same transaction. Other open offers remain open in storage but become read-only by derived UI/API rules. The partial index prevents a transient second accepted row. Increment Member revision once, read the resulting snapshot and record the receipt, then commit. No external requests inside the transaction.
6. Retry Prisma `P2034` conflicts/deadlocks at most three times with jitter, re-running all validation; never automatically refresh the user's expected revision. Exhaustion returns `409 RETRY_CONFLICT`. Unexpected partial-index conflicts become `409 ACCEPTANCE_CHANGED` after rollback, not a success. [Prisma v6 transaction guidance](https://www.prisma.io/docs/orm/v6/prisma-client/queries/transactions).

The same lock/revision discipline covers quantity edits, new offers, withdrawal, import commits/repairs, clearing acceptance and deletion. Race outcomes must be either one committed change plus a conflict, or a valid serial sequence, never two accepted rows or an accepted offer exceeding its want.

## 3. API routes

Next.js App Router handlers live at `app/api/.../route.ts`, use Node runtime and dynamic/no-store reads of group state. UUID identifiers throughout. Dates are ISO strings; monetary values are decimal strings (`"25.00"`), never binary floats. Respond with `{error:{code,message,fieldErrors?,details?}}` on errors. Every successful mutation returns the new `revision`; gallery-changing responses include the refreshed list snapshot. All mutating bodies carry `actorMemberId`, `requestId`, and `expectedRevision` unless exempted below. POST creation returns 201; updates return 200; deletes return 200 with `{deletedId,revision}` so clients can reconcile.

Common types:

- `MemberDTO`: `{id,name,color,revision}`.
- `OfferDTO`: `{id,wantId,offerer:{id,name,color},qty,unitPriceHkd,status,editable,createdAt,updatedAt}`. `editable` is derived for the selected actor; status alone does not mean editable.
- `WantDTO`: `{id,scryfallId,cardName,imageUrl,setCode,collectorNo,rarity,colors,qty,offers,acceptedOfferId,coveredQty,remainingQty}`.
- `ListDTO`: `{member,wants,unresolvedImports:[{id,batchId,lineNo,rawText,parsedName,qty,reason}],total:{amountHkd,pricedCards,unpricedCards,remainingCopies}}`. Remaining copies count accepted coverage only; provisional offers are not commitments.

| Handler | Request → response and behavior |
| --- | --- |
| `GET /api/members` | → `{members:MemberDTO[]}` alphabetically. No actor required. |
| `POST /api/members` | `{name}` → `{member}`; no identity/revision required. Duplicate normalized name: 409 `NAME_EXISTS` with existing member, allowing picker recovery. Server assigns color. |
| `GET /api/members/:id` | Optional `?actorMemberId=...` → ListDTO. Include unresolved queue so unknowns survive reload. |
| `PUT /api/members/:id/wants` | Common fields plus `{items:[{scryfallId,qty}],resolveLineIds?:[],importBatchId?:...}` → `{list,applied:[{scryfallId,qty}],resolvedLineIds}`. Absolute quantities only; omitted cards unchanged; qty 0 deletes with cascade. Reject duplicate IDs in one request. Server hydrates/validates card metadata. Owner-only edits; qty-zero deletion allowed to any actor, but non-owner requests may contain only deletions. |
| `DELETE /api/wants/:id` | Common fields → deleted ID/revision. Any selected member; inline confirmation in UI. |
| `POST /api/members/:id/imports` | `{actorMemberId,requestId,text}` → `{batchId,baseRevision,lines:[{id,lineNo,parsedName,qty,state,reason,scryfallId?}],proposedItems:[{scryfallId,currentQty,importQty,targetQty}]}`. Owner required. Persists parsed lines and resolved metadata identity, not Want changes. Uses requestId and content hash for replay. No expected revision because this stages a review; returns current revision. |
| `GET /api/members/:id/imports/:batchId` | → same staged report with current proposed absolute targets. Resolved/ignored lines already consumed are marked and excluded. |
| `PUT /api/import-lines/:id` | Common fields plus `{scryfallId,absoluteQty}` → `{list,line:{id,state:"resolved",resolvedScryfallId}}`. Owner required; atomically upsert absolute qty and consume unresolved line. `absoluteQty` must be positive. Already-consumed line returns 409 unless identical requestId replay. |
| `DELETE /api/import-lines/:id` | Common fields → ignored line/revision; any member can dismiss with inline confirmation. |
| `POST /api/wants/:wantId/offers` | Common fields plus `{offererId,qty,unitPriceHkd}` → `{offer,list}`. Actor must equal offerer. Existing open/accepted row: 409 `OFFER_EXISTS`; withdrawn row may reopen with new values. |
| `PUT /api/offers/:id` | Common fields plus `{qty,unitPriceHkd}` → `{offer,list}`. Absolute replacement for debounced autosave. Only own open offer while no accepted sibling. |
| `PATCH /api/offers/:id` | Common fields plus `{status:"withdrawn"}` or `{qty,unitPriceHkd}` → `{offer,list}`. Retains SPEC sketch compatibility; edits share PUT validation. Withdrawal is explicit, never caused by empty fields. |
| `POST /api/offers/:id/accept` | Common fields plus `{expectedAcceptedOfferId:null-or-id}` → `{list}`; transaction above. |
| `POST /api/wants/:id/clear-acceptance` | Common fields plus `{expectedAcceptedOfferId:id}` → `{list}`. Owner only; accepted → open, re-enables all offers. Wrong ID: 409. |
| `DELETE /api/offers/:id` | Common fields → deleted ID/revision. Any member, including for accepted offers; confirmation explains coverage removal. |
| `DELETE /api/members/:id` | `{actorMemberId,requestId,expectedRevision}` → `{deletedId,affectedMemberIds}`. Any member, expanded confirmation. Missing target on repeat returns 404; no receipt can survive the deleted member's cascade. |
| `GET /api/members/:id/export` | → `text/plain; charset=utf-8`, attachment filename based on sanitized member name. One `<qty> <canonical name> (<SET>)` line per resolved want, uppercase set. UI exposes on own list only; no access-control claim. Unknowns excluded with an export warning/count. |
| `GET /api/cards/autocomplete?q=...` | → `{names:[...]}`; server proxy to Scryfall autocomplete with shared queue/cache. |
| `GET /api/cards/resolve?name=...&set=...` | → `{card:{scryfallId,cardName,imageUrl,setCode,collectorNo,rarity,colors}}`; exact resolution for a selected autocomplete name. Unmatched 422; upstream failure 503. |
| `GET /api/health` | → `{status:"ok"}` after database readiness probe; otherwise 503. No secrets. |

### Validation and offer policy

Malformed JSON/UUID: 400. Missing resource: 404. Invalid quantity/name/money: 422 with field errors. Actor mismatch: 403. Stale revision, frozen sibling, duplicate or consumed operation: 409 with actionable current state. Scryfall timeout/429/5xx is 503 `CARD_LOOKUP_UNAVAILABLE`, not “unknown card.” Keep local input for retry. No partial writes within a commit request.

Recommend `1 <= offer.qty <= want.qty`; smaller offers are allowed, larger ones rejected rather than silently capped. Zero HKD is allowed for gifts; no negative price or exponent/currency-marked inputs. Want decreases below any active open/accepted offer qty fail with 409 `OFFER_QTY_CONFLICT`, listing affected offers; owner must clear acceptance and arrange edits, or use the locked anyone-can-delete action. Withdrawn offers do not block decreases. Increasing a want is always valid.

Once an offer is accepted, creation/edit/withdrawal of all offers on that want is frozen. Siblings stay visible and dim. Accepted offers cannot be edited or withdrawn: return 409 `ACCEPTED_OFFER_IMMUTABLE`; owner can clear acceptance first, or anyone can explicitly delete it. Sibling edit/withdraw returns `409 WANT_HAS_ACCEPTED_OFFER`. This follows **Owner decisions §2** read-only siblings and own-open-offer editing; delete remains a separate trust-based action under §5. Accepting a different offer is an explicit replacement, as the API sketch permits.

### Import merge and repair semantics

SPEC **Owner decisions §4** requires quantity merging on re-import; **API shape (sketch)** requires absolute PUTs. Reconcile them at the review boundary: with current qty 2 and pasted qty 3, propose absolute target 5, then PUT 5 once. Sum duplicate lines by resolved Scryfall ID before proposing targets. A new intentional import of the same text proposes 8; a network retry of the same requestId returns the saved result and leaves 5. Detect identical contentHash and show “This list was imported before; importing again adds quantities” before creating a new batch. Do not use contentHash as permanent deduplication, because deliberate repeated imports must remain possible.

Stage each parsed line as unresolved until its contribution is committed; a staged exact match may have `resolvedScryfallId` populated while state remains unresolved. Ignored headings/comments start ignored. Staging takes the member lock, increments revision once for the new queue entries and returns that revision as baseRevision; replay does not increment again. Scryfall work finishes before this short transaction. Staging and committing use different requestIds. Commit passes importBatchId and the contributing `resolveLineIds`; verify all belong to this member/batch, remain unresolved, and map to the submitted IDs. Under the member lock, recompute expected targets as current qty plus these line quantities and require submitted absolute values to match. Apply target quantities and mark lines resolved in the same transaction. A failed commit consumes nothing. Unmatched and malformed lines stay visibly queued, while matched lines can commit. Empty/no-match imports still retain their report.

For later repair, selecting a real card proposes current qty plus the unresolved contribution; the user can correct that absolute target before PUT. Atomically set the target and consume the line. Example: current Lightning Bolt 2, unknown “Lighning Bolt” qty 3 → repair target 5; retry leaves 5. If another member's action advanced revision, return 409 and show refreshed target rather than adding again. Resolved lines never return to the queue after a want is deleted. Plain absolute PUT (without importBatchId) remains available for one-off add/edit and correcting legacy bad quantities; it never increments implicitly or accepts raw card names as keys.

## 4. Import parser spec

Treat each physical line independently; preserve rawText only in the import report. Normalize CRLF/LF, strip one initial BOM, trim surrounding whitespace, retain original line numbers. No multiline card records. Blank lines, whole-line `#`/`//` comments and recognized export headings (`Deck`, `Mainboard`, `Sideboard`, `Commander`, `Companion`, `Maybeboard`, optionally ending in `:`) are reported as ignored. All card-bearing sections contribute to the single wantlist; do not silently drop sideboard cards. Unsupported headings/lines become reported invalid lines.

Grammar, with suffix extraction performed right-to-left:

```text
line       := quantity HWS name [HWS printing] {HWS annotation}
quantity   := positiveDigits ["x" | "X"]
printing   := "(" setCode ")" [HWS collector]
setCode    := 2..16 ASCII letters/digits, case-insensitive
collector  := digit {ASCII letter/digit | "-" | "*" | "★" | "†"}
annotation := "[" nonBracketText "]" | "*F*" | "*E*"
HWS        := one or more spaces/tabs
name       := nonempty remaining Unicode text after recognized suffix removal
```

Quantities are decimal integers 1–9999, leading zeros accepted then normalized. Require whitespace after `4`, `4x` or `4X`; reject `4xCard`. A missing quantity is a reported error, not a silent quantity 1. Repeated trailing annotations are stripped; `*F*` and etched `*E*` are case-insensitive. Only recognize a collector token after a `(SET)` suffix; never strip a bare number from a name such as “The 14th Doctor.” Preserve apostrophes, commas, hyphens, Unicode, internal parentheses and `//` in split/DFC names. A terminal parenthesized token matching setCode is interpreted as a set; a failed lookup is repairable, not silently rewritten. Inline comments are unsupported so `//` remains a card-name separator. Bare foil words, unsupported finish flags and malformed tags produce a visible parse/lookup issue rather than heuristic truncation.

Examples:

| Input | Parsed result |
| --- | --- |
| `4x Lightning Bolt (m11) 149 [Instant] *F*` | qty 4; name Lightning Bolt; set m11; collector 149; finish/tag removed |
| `2X Fire // Ice (MH2) 290 [Instant]` | qty 2; intact split name; set mh2; collector 290 |
| `1 The 14th Doctor` | qty 1; full name preserved |
| `1 Boseiju, Who Endures (NEO) 266` | punctuation preserved; printing constraint retained |
| `0 Island`, `Island`, `4xCard`, `3 [Creature]` | reported invalid, no Want created |
| `2 Definitely Not A Card (ABC) 123` | parsed candidate retained in report; unresolved until repaired |

### Scryfall resolution

Use collection lookups for exact import candidates, in chunks of at most 75 unique identifiers. Priority: set + collector number, otherwise exact name + set, otherwise exact name. Check the returned canonical name against the parsed name for printing lookups; a mismatched set/collector is a report issue, not permission to import an unrelated card. A supplied printing constraint must not silently fall back to another printing. Without printing information, select the returned default printing and show it in review. Identity remains `(memberId,scryfallId)` as sketched in SPEC: two printings can be distinct wants. Re-importing a name-only card already in this member's list reuses the existing unique matching canonical-name printing; if several match, require a choice. This avoids changing quantities merely because Scryfall's default printing changed.

There is no “bulk fuzzy” collection endpoint. Batch exact lookups first; for unmatched **name-only** candidates, serialize `/cards/named?fuzzy=...` calls and offer a successful result as a suggestion requiring selection, not an automatic match. Ambiguous/no-result names remain unresolved. For explicit printing mismatches, ask the user to correct printing or explicitly select a suggested alternative. Autocomplete (`/cards/autocomplete?q=...`) is for interactive typing and repairs, not resolving every pasted line; selecting a returned name then does exact resolution. No bulk-card dataset download or local catalog for a ten-person v1. Endpoint contracts: [collection](https://scryfall.com/docs/api/cards/collection), [named](https://scryfall.com/docs/api/cards/named), [autocomplete](https://scryfall.com/docs/api/cards/autocomplete); verify these contracts with live probes before implementation because documentation access was blocked during planning.

Deduplicate requests; queue server Scryfall work with at least 110ms between starts, one in flight, bounded retries and shared in-process metadata cache (24h exact IDs, 1h name mappings, 30s negative lookups). Send descriptive server User-Agent and Accept headers. Use top-level image URI, otherwise first face image; union face colors when top-level colors absent. Store canonical card name, actual set/collector, rarity, colors and image URI. Unknown-name reports show line number, raw line, parsed name/qty, reason, suggested correction and “Ignore”; a persistent banner states unresolved count. Network failures remain retryable lookup errors, never classified as unknown names. Scryfall asks for fewer than ten API requests per second: [official rate-limit guidance](https://scryfall.com/docs/faqs/i-m-having-trouble-accessing-the-scryfall-api-or-i-m-blocked-17).

## 5. Gallery + sticker component plan

Direct inspection of [refs/mockup.png](../refs/mockup.png): six columns, 22 cards, 17 prominent labels; KK is bright red, Osmond dark burgundy, Guluball royal blue. The thick rounded white halo separates each name from busy art. Five unlabeled cards communicate “no offers” without extra chrome. Preserve that signal while adopting the locked dark theme; do not copy the white canvas.

Components: `MemberSwitcher`, `WantGallery`, `ColorSection`, `WantTile`, `OfferStickerStack`, `WantActionSheet`, `OfferEditor`, `ImportSheet`, `UnresolvedImportQueue`, `AutosaveStatus`, `ListTotal`. Card tile is a keyboard-operable button opening the action sheet. Name overlays have pointer-events disabled so they do not intercept activation. No nested interactive buttons in the tile. Offer selection occurs in the sheet, with full names, quantities, unit and extended prices.

Use CSS text overlays, not raster labels or canvas. Position a sticker cluster around 50% across and roughly 32–36% down the whole card, which centers it on the artwork rather than the rules text. Bold 800–900 text, member color, a thick white text stroke with painted fill over stroke and a multi-directional shadow fallback. Preserve rounded letter halos; avoid turning the name into a generic rectangular badge. At 240px card width, target 32–44px type, shrinking for long names with a two-line limit. Full name remains in accessible text and the sheet. No new raster art is needed.

Recommend up to two centered name stickers stacked vertically, then a compact `+N offers` line for additional offerers. Stable ordering by offer createdAt then ID, not by typing or price changes. With acceptance, accepted name becomes the large primary sticker with a small check/“Accepted”; all other names stay in a smaller dim strip (first two plus count), and every offer remains visible in the sheet. This extends the mockup's single-name concept without obscuring the entire card.

| State | Tile and sheet treatment |
| --- | --- |
| No active offers | No name sticker, as in mockup. Small quantity marker “Need 4”; card opens actionable form/management. Withdrawn offers do not count. |
| Open offers | Colored names plus small offer count; “Need 4 · 3 offers.” Do not sum competing offers into fulfilled quantity. |
| Open partial offer | Sheet says “2 offered of 4 needed”; still zero committed coverage. |
| Accepted, fully covered | Accepted sticker/check; quantity “4/4 accepted.” Other offers dim and read-only. |
| Accepted, partially covered | “2/4 accepted · 2 still needed.” Only one accepted offer remains allowed; no second acceptance to fill the gap. Owner may replace or clear the acceptance. |
| Unknown import | Separate visible repair queue with parsed candidate and raw-line context, not a fabricated card tile or hidden want. |
| Image unavailable | Same aspect-ratio dark tile with canonical card name and rarity; stickers and actions still work. |

Palette assignment: choose the least-used color from a fixed ten-color palette in deterministic palette order; persist hex on Member so colors do not shift when members are added/deleted. Suggested palette: red `#E60023`, burgundy `#650F26`, royal blue `#173BDB`, teal `#006B60`, violet `#7435B8`, orange `#B94300`, green `#237A24`, magenta `#B51C80`, brown `#794426`, slate `#315A73`. Reuse after ten, always retaining names so color is not the only identifier. Concurrent creation may reuse a color; uniqueness is not a data invariant. Do not hardcode named members from the mockup into production.

Grid: 8–12px gaps, centered max width around 1500px; two columns below 600px, three at 600, four at 900, five at 1200, six at 1450. Cards shrink below 240px on narrow screens; retain two columns at 320px without horizontal scrolling. Preserve image aspect ratio, `loading="lazy"`, asynchronous decoding and hotlinked `image_uris.normal` in ordinary image elements. Group White → Blue → Black → Red → Green → Multi → Colorless using card colors (not commander color identity); empty colors means Colorless. Within group sort mythic → rare → uncommon → common → unknown, then canonical name and printing. Rarity gem has text/accessible label as well as orange/gold/silver/dark color. Sources: SPEC **Gallery UX contract** and **The mockup**.

Edits autosave after 500ms of valid idle input through PUT, with Saving…/Saved/Retry states announced politely. Keep blank/incomplete monetary inputs local; never save them as zero. Serialize saves per list and use returned revision for the next queued edit; ignore stale responses. On 409 retain the draft, show current data and an inline reapply choice. Initial offer creation waits until both required fields are valid, then POSTs once with requestId; subsequent edits use PUT. Acceptance, replacement, removal and import commit are explicit actions. Confirm destructive effects inline, never through native alert/confirm/prompt. Focus trap/Escape/return-focus for sheets; retain unsaved draft on close and show retry status. Refresh snapshots on focus and every 30s while visible; don't overwrite local drafts. No realtime subscription needed.

Footer per SPEC **Owner decisions §3**: `Total if all accepted: HK$X`. For each want, use accepted `qty × unitPriceHkd`; otherwise choose the open offer with cheapest unit price (tie: greater qty, then creation time/ID) and use that offer's actual qty × unit price. Sum in decimal/cents. Never multiply a partial offer by unoffered copies, never combine competing offers, and never add a sibling estimate to a partially accepted want. Show subtext “Based on offered quantities; X cards without offers; Y copies still needed” to make the locked total label's limits clear. Withdrawn offers and unresolved imports contribute no money; show unresolved count separately. Recommendation is explicitly included in the final table because “cheapest” is underspecified.

## 6. Reference price

Fetch `https://api.scryfall.com/cards/:scryfallId` in the browser when an offer sheet opens, not once per tile on every gallery render. Use only `prices.usd`, display `~US$12.34 (TCG mkt)` adjacent to the HKD-per-copy field; never convert currencies, prefill the offer price, or substitute foil/EUR prices. Read-only hint, not a price promise. Source: SPEC **Owner decisions §3**, **Data model (sketch)** and **Open items for the plan**.

Use a browser-wide request scheduler, one in flight and minimum 110ms start spacing (slightly more conservative than the roughly 50–100ms courtesy interval). Deduplicate in-flight calls by ID; memory plus sessionStorage price cache, TTL 15 minutes. Share cache notifications across tabs where available; import/autocomplete use their separate server queue. Per-browser throttling cannot globally coordinate separate members, so lazy fetching and small request volume matter. API courtesy does not require spacing image-CDN hotlinks. See [Scryfall's API limits](https://scryfall.com/docs/faqs/i-m-having-trouble-accessing-the-scryfall-api-or-i-m-blocked-17).

Cache null prices too. Loading: “Reference loading…”; null/missing/non-numeric: “USD reference unavailable”; zero string: `~US$0.00`. On failure show unavailable with Retry while keeping the offer form usable. A cached expired value may remain with “stale” and timestamp during refresh. On 429 stop queue dispatch, respect Retry-After where exposed, otherwise back off 1/2/4 seconds with jitter and stop after three attempts; never aggressively retry. Abort unnecessary queued requests on sheet close. No price is stored in Postgres or used in HKD totals.

## 7. Build order

This pass creates only this document. The following are acceptance gates for a later implementation pass; no build or API probe is claimed to have run in the current greenfield repository.

| Phase | Implementation scope | Headless verification and exit criteria |
| --- | --- | --- |
| 1 — schema + API | Pin stack; Prisma schema/migration including partial index/checks; member/list APIs; shared mutation transaction and receipts; offers API; import staging contracts. | `npx prisma validate`, `npx prisma generate`, migrate a disposable Postgres DB; `npx tsc --noEmit`; `npm run build`. Curl create members, set/get wants, offer/accept/replace/clear/delete. Two concurrent accepts with same revision yield one success and one 409; direct attempt at second accepted row fails DB constraint. Verify cascade deletion and revision changes, money precision, quantity conflicts and stale writes. |
| 2 — gallery + import | Picker, routes, dark grouped grid, placeholders, autocomplete, paste review, persistent unknown queue, absolute merge/repair/export. | Build and typecheck. Parser fixture tests for every grammar example, duplicate lines, DFC, Unicode, sections, bad printing and lookup outage. Curl staged import then PUT commit twice with one requestId: qty changes once; new batch adds again. Repair an unknown twice: one contribution. Delete then reload: consumed line stays consumed. Export resolved lines; verify unresolved warning. Live Scryfall probes confirm collection limit/identifier shapes and exact/fuzzy/autocomplete behavior before relying on them. |
| 3 — offers + stickers | Multi-name overlays, offer autosave, actor-specific action sheets, acceptance/replacement and partial coverage, price hint, footer. | Build/typecheck; curl other-person edit 403, accepted withdrawal 409, frozen sibling mutation 409, over-qty 422, free offer success, deleting accepted offer reopens siblings. Verify footer fixtures with unequal quantities and partial acceptance. Mock Scryfall null/429/timeout; verify queue spacing/cache/dedup. DOM/browser automation checks sheet activation, keyboard focus and no native dialogs. |
| 4 — polish + deploy | Mobile layouts, accessibility, error/retry/loading/empty states, production container, Railway and DNS. | Build/typecheck; run container against disposable DB with nondefault `PORT=8080`; curl readiness, pages, static assets and mutation APIs. Restart twice: migrations remain safe, data persists. Deliberately fail migration: server must not start. Resolve CNAME/TXT and curl HTTPS after deployment. |

Headless curl sequence uses actual returned IDs/revisions: create A/B/C; PUT A want qty 4; B offer qty 2 at `"10.00"`; C offer qty 4 at `"12.00"`; accept B; assert covered 2, remaining 2 and total `"20.00"`; replacing B with C gives coverage 4 and total `"48.00"`. Probe endpoints with `curl -i` (or `curl.exe` on Windows), JSON content type and saved request bodies. A request retry uses the exact same requestId/body; a new action gets a new UUID. In concurrency tests inspect both HTTP results and database accepted-count, not just UI appearance.

Build/typecheck cannot prove visual match. Before owner review, render screenshots at 320/390/768/1024/1500px and inspect against the reference: centered white-halo names, long/multiple names, partial status, image failure, dense spacing. Inspect focus order and autosave error recovery. This is verification of built UI, not generation of new raster assets.

## 8. Deploy plan

SPEC **Owner decisions §6** and **Open items for the plan** require Railway, Postgres, startup migrations and standalone output.

### Standalone Dockerfile specification

Plan a multi-stage Dockerfile using the same pinned supported Node LTS Debian slim base in dependency, build and runtime stages (recommend Node 22), with OpenSSL/CA certificates available for Prisma/Postgres. Dependency stage runs `npm ci` from committed lockfile. Builder runs Prisma generate then Next build with `output: "standalone"`; database-backed pages must remain dynamic so build does not need a live production database.

Runtime copies `.next/standalone` to `/app`, `.next/static` to `/app/.next/static`, and `public` to `/app/public` when present. Also copy `prisma/schema.prisma`, migration directory, generated Prisma client/engine assets, and an explicitly packaged Prisma **6** CLI with all runtime dependencies: Next tracing must not be assumed to include the migration CLI. Keep CLI/client versions matched. Use a non-root runtime user. There is no `/app/data` directory or JSON catalog to copy. Standalone requires manually copying static/public assets and supports `PORT`/`HOSTNAME`: [Next.js 15 standalone documentation](https://nextjs.org/docs/15/app/api-reference/config/next-config-js/output).

The entrypoint must run the bundled `prisma migrate deploy` against DATABASE_URL and only on success `exec node server.js`; fail startup if migration fails. Do not use migrate dev, db push, generate migrations at boot, or download an unpinned CLI via npx. Set `NODE_ENV=production`, `HOSTNAME=0.0.0.0`, default PORT 3000 only when absent; honor Railway's injected `$PORT`. `EXPOSE` does not control the listener. Keep one app replica initially; migrations remain versioned and forward-compatible. Verify Prisma engines load in the final image, not only builder. Startup migration behavior follows [Prisma v6 production migrations](https://www.prisma.io/docs/orm/v6/prisma-migrate/workflows/development-and-production).

### Railway provisioning checklist

1. Create/select project and production environment; provision a persistent Postgres service and app service connected to the repository/Dockerfile. Record project, environment, app service and Postgres service IDs. Provisioning is future work, not performed in this doc-only pass.
2. Bind app `DATABASE_URL` using Railway's Postgres service reference, preferably private networking in the same environment. Set `NODE_ENV=production`, `HOSTNAME=0.0.0.0`; let Railway supply PORT. Optional `APP_ORIGIN=https://trademtg.crimsondesign.pro` for links. No Scryfall API key or public database URL variable. Keep Railway automation token outside the application environment.
3. Configure health check `/api/health`, startup allowance sufficient for migrations, and restart policy. Enable Postgres backups; rehearse restore before important real data accumulates. Build/deploy, inspect migration logs, probe temporary Railway HTTPS domain, then verify app restart preserves data.
4. For GraphQL automation use Railway's public API with an appropriately scoped token; look up existing IDs before creation to avoid duplicates. Create services/variables/deployment using the current schema, then `customDomainCreate` with projectId, environmentId, serviceId and `trademtg.crimsondesign.pro`. Capture domain ID, `status.dnsRecords`, `status.verificationToken`, and selected target port. Query `customDomain` until DNS status is valid and certificate issued. Do not hardcode guessed CNAME targets or verification tokens. [Railway GraphQL domain operations](https://docs.railway.com/integrations/api/manage-domains).
5. In Cloudflare zone `crimsondesign.pro`, add CNAME name `trademtg` → the exact Railway-provided target. Add verification TXT at the exact host Railway supplies, expected `_railway-verify.trademtg` (FQDN `_railway-verify.trademtg.crimsondesign.pro`) → exact verification token. Check the returned label before entry; do not accidentally place the token at the apex or append the zone twice. Use DNS-only initially to make routing/certificate diagnosis simple; leave it DNS-only for v1 unless proxying is later desired. Both CNAME and TXT are required. [Railway domain setup](https://docs.railway.com/networking/domains/working-with-domains).
6. Verify authoritative/public DNS answers, Railway verification and TLS certificate, then `curl -I https://trademtg.crimsondesign.pro` and health/API probes. Confirm HTTPS hotlinked images, client Scryfall calls, import persistence and target-port routing. Keep the TXT record. For failed rollout, restore previous app image only if schema-compatible; do not automatically reverse migrations or destroy the database.

## 9. Decisions for owner — batch approval

Everything below is a recommendation pending owner approval; locked choices are not reopened. Implementation details such as indexes, request receipts and transaction ordering are engineering requirements for the chosen behavior, not additional product approval gates.

| # | Remaining choice | Recommendation |
| --- | --- | --- |
| 1 | All-lists overview | Omit; picker plus compact viewed-member switcher. Keep acting identity distinct. |
| 2 | Member names and URLs | 1–40 normalized characters, case-insensitive uniqueness, encoded name segment, reserved/slash names rejected; no rename UI in v1. |
| 3 | Multiple offer stickers | CSS overlays: two centered names plus `+N offers`; accepted name dominant, dim sibling strip; complete list in sheet. |
| 4 | Member colors | Persist least-used color from the ten-color palette; reuse after ten; no custom color editor in v1. |
| 5 | Offer quantity mismatch | Allow 1..want qty, including partial offers; reject excess. Block want decreases that invalidate active offers. Qty cap 9999. |
| 6 | One member's competing offers | One offer row per member/want; edit it or reopen after withdrawal, rather than multiple differently priced rows by the same person. |
| 7 | Changing acceptance | Explicit replace-current action with stale-state checks; owner may clear acceptance. Accepted offers immutable; deletion still available to anyone under locked trust rule. |
| 8 | Offers after acceptance | Freeze new offers and edits/withdrawals while any offer is accepted, including partial coverage. Clear/replace acceptance to continue. |
| 9 | Cheapest-offer total | Choose lowest unit price, tie by greater qty then stable order; multiply by actual offered qty. Partial acceptance contributes only its own cost. Show unpriced/remaining coverage beside locked footer label. |
| 10 | HKD formatting and gifts | `HK$1,234.50` consistently, two decimals; permit zero-price gifts. USD hint `~US$12.34 (TCG mkt)`, no conversion. |
| 11 | Intentional repeated imports | Add quantities for each new confirmed batch; replay same requestId without adding. Warn on repeated content, retain explicit “Import again” action. |
| 12 | Unknown/fuzzy imports | Persist unresolved lines visibly outside Want rows; commit known cards, repair later. Require choosing fuzzy suggestions. Never use raw lines as card identities. |
| 13 | Printing identity | Respect explicit set/collector; separate Scryfall printings may be separate wants. Reuse unique existing printing for name-only re-import; ask if several exist. No foil distinction in want IDENTITY — foil lives as an attribute instead: want foil preference (foil/non-foil/either, default either), offer actual finish (default non-foil); mismatch = warning icon (owner decision 2026-10-23). |
| 14 | Deck sections/parser extensions | Import all recognized card sections into the one list; strip bracket tags and `*F*`/`*E*`. Missing qty defaults to 1 (owner decision 2026-10-23). Unsupported syntax is still reported, never silently guessed. |
| 15 | Mobile grid and sheets | Two columns even at 320px; 3/4/5/6 at 600/900/1200/1450px. Bottom sheet on mobile, dialog on desktop; full names in sheet. |
| 16 | Export visibility | Show export only on own list; public endpoint remains consistent with no auth. Resolved cards only, with visible unresolved-count warning. |
| 17 | Autosave and freshness | 500ms valid-input debounce; serialized writes; retain drafts on conflict. Refresh on focus and every 30s while visible; no realtime infrastructure. |
| 18 | Destructive management | Any selected member can delete wants, offers, import issues or members; inline confirmation explains cascades, especially accepted-offer/member deletion. |
| 19 | Reference price cache | Lazy fetch on offer-sheet open, 15-minute browser-session cache, 110ms queue spacing; show unavailable/stale explicitly. |
| 20 | Initial deployment defaults | Single app replica, Node 22 LTS base, Postgres backups, DNS-only Cloudflare record initially; migrate at every boot and fail closed on migration error. |
