# TradeMTG — Product Spec (K3, owner-approved decisions 2026-10-21)

Internal group MTG card-trading webapp. ~10 members, ~20–30 cards per wantlist. Ease of use over everything; no auth, no security concerns, no moderation.

## Owner decisions (LOCKED)

1. **Per-person wantlists.** Every member has ONE wantlist of `card + qty needed`. Any member can put offers on cards in anyone's list. (Not one shared group list.)
2. **Multiple offers per card, no locking.** An offer = `offerer + qty offered + unit price`. The list owner picks at most one offer per card and marks it **accepted**; remaining offers on that card dim (stay visible, read-only). Offerers can edit/withdraw their own open offers.
3. **Pricing in HKD.** Offerer enters price per copy in HKD. Show a **reference price** next to the offer form sourced from Scryfall (`prices.usd`, TCGplayer market) as a USD hint — no direct TCGplayer API integration. List footer shows `Total if all accepted: HK$X` (sum over accepted offers, else sum over cheapest open offer per unfilled card). Buyers may set an optional per-want **target price** (max HKD they will pay); offerers see it in the offer form (`Buyer expects ≤ HK$X`); offers above target are allowed but flagged, never blocked.
4. **Card entry: paste-a-list import + autocomplete.** Import accepts real decklist exports (Moxfield/Archidekt): `4x Card Name (set) 123 [Type] *F*` — `N`/`Nx`/`NX` qty prefixes, case-insensitive set code, trailing collector number, `[Type]` tags, foil flags stripped. A line with no qty prefix defaults to qty 1 (owner decision). Wants carry a **foil preference** (`foil` / `non-foil` / `either`, default `either`, edited manually per card — never inferred from import `*F*` flags). Offers carry the actual copy's finish (default `non-foil`); a finish that mismatches the buyer's preference shows a warning icon (either accepts all). Merge quantities on re-import. Unknown names accepted AND visibly reported. **Never store an unmatched line's raw text as the card name** (league-app lesson: invisible rows + double-count on re-import). Plus a Scryfall autocomplete "add card" box for one-offs.
5. **No auth.** Pick-your-name dropdown + free-add new member (league-app pattern). Statuses: `offered → accepted` (accepted set by list owner only). No paid/delivered tracking. Anyone can delete anything (group trust), with inline confirms.
6. **Stack: Next.js 15 App Router + Prisma 6 (`^6.6`, never v8 rc) + Postgres. Deploy on Railway**, custom domain `trademtg.crimsondesign.pro` (Cloudflare DNS). Migrations at container start. `output: "standalone"`.

## The mockup (`refs/mockup.png`) — owner-drawn reference

22 cards, 6-column grid on white canvas. Seventeen cards carry a **large name sticker centered on the artwork** — the offerer's name in a strong color with a thick white rounded outline ("KK" red, "Osmond" dark burgundy, "Guluball" royal blue). Five cards have no sticker = nobody offering. **No other chrome** — the concept is: image grid, name-on-card = who can offer it.

Interpretation for per-person lists: each member's wantlist page IS this gallery — card images in a dense grid; offerers' names appear as stickers on the cards; no sticker = no offers yet. Sticker style: bold colored text, white rounded halo, per-member consistent color (auto-assigned from a palette).

## Gallery UX contract (locked, from Percy's established webapp conventions)

- Dark theme, mythicspoiler-inspired dense grid, ~240px cards, responsive (2 cols mobile → 6 desktop), `loading="lazy"`, dark placeholder tile showing card name on image error.
- Card images: Scryfall `image_uris.normal` (small is fine for grid), hotlink OK. Store `scryfallId` per want; resolve names via Scryfall at import time.
- **Click a card = act, never navigate.** Owner clicking own want → manage (edit qty, remove, view/accept offers). Other member clicking → offer form (qty + HKD price + reference price shown).
- Rarity gem per card (mythic orange / rare gold / uncommon silver / common dark), color-grouped sections (White → Blue → Black → Red → Green → Multi → Colorless), rarity sort within group.
- Every edit autosaves (debounced PUT + Saving…/Saved indicator). No native `alert`/`confirm`/`prompt` anywhere — inline confirms/modals.
- Export own list as `<qty> <name> (SET)` lines.

## Data model (sketch — astra refines)

- `Member(id, name @unique, color, createdAt)`
- `Want(id, memberId, scryfallId, cardName, imageUrl, rarity, colors, qty, createdAt)` — `@@unique([memberId, scryfallId])`; `cardName` denormalized for display/sort; want rows never keyed by free-text name.
- `Offer(id, wantId, offererId, qty, unitPriceHkd, status: open|accepted|withdrawn, createdAt, updatedAt)` — at most one `accepted` per `wantId` (enforce in transaction).
- Reference prices: fetched client-side from Scryfall API (`/cards/:id`) at view time, cached briefly; not stored.

## API shape (sketch — astra refines)

- `GET /api/members`, `POST /api/members {name}`
- `GET /api/members/:id` → member + wants (with offers embedded) 
- `PUT /api/members/:id/wants` — absolute-set import merge (idempotent repair: PUT correct scryfallId with absolute qty; qty 0 deletes)
- `POST /api/wants/:wantId/offers {offererId, qty, unitPriceHkd}`, `PATCH /api/offers/:id` (edit/withdraw), `POST /api/offers/:id/accept` (list owner only; transaction unaccepts siblings)

## Open items for the plan

- IA: landing = member picker → `/[name]` list. All-lists overview needed? (Owner lean: no, or a tiny member-switcher.)
- Sticker rendering: pure CSS overlay vs canvas — recommend CSS (zoom/perf simplicity).
- HKD↔USD: display reference as `~US$X (TCG mkt)` next to HKD input; no auto-conversion.
- Deploy details: Railway GraphQL provisioning, Dockerfile with `COPY /app/data` not needed (no JSON catalog; Postgres only), `$PORT` listen, migrations at boot.
