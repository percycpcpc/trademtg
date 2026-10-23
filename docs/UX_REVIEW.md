# TradeMTG UX review

23 October 2026. Exactly ten improvements, ranked for a casual group of roughly ten friends: remove blocked or misleading actions first, then reduce effort and polish presentation.

Evidence: directly inspected all five requested screenshots in `refs/ux-review/`, the additional `03-sheet-owner-offers.png`, and `refs/mockup.png`; read `SPEC.md`, `docs/PLAN.md`, routes, components and CSS. Screenshot names are not proof of actor state: `02-gallery-owner.png` and `03-sheet-offerer.png` show “Choose name…”, and the extra `03-sheet-owner-offers.png` contains no open sheet. Findings below distinguish visible evidence from source-derived behavior. No live requests or mutations were made; mobile, error, import-result and export findings are source-based, not claimed browser tests. KK and Percy appear in the picker; their data was not inspected.

All fixes retain the dark theme, image grid, click-to-act sheets, name stickers, hotlinked Scryfall images, no auth, HKD entry with a USD market hint, autosave and inline confirmations. No card-detail pages, dashboard, onboarding tour or new trade statuses are proposed. Source line references describe the reviewed checkout.

## 1. Make choosing a name establish identity, then separate browsing

**Evidence:** `01-picker.png` promises “Choose your name to open your wantlist.” `02-gallery-owner.png` instead shows an unselected actor and no import controls. `app/page.tsx:1`; `app/ui.tsx:46–67` navigates without storing identity; `app/ui.tsx:104–157` reads a previously stored actor and renders the viewed member as static text. `docs/PLAN.md:11–17` specifies identity selection and independent list switching.

**Problem:** A first-time member appears to choose themselves but cannot manage their list. A returning visitor can unknowingly retain somebody else's acting identity. To browse a friend's wants they must return to a picker whose meaning is ambiguous.

**Exact fix:** In `Picker`, have a member selection store that member ID in `localStorage.actor` before navigation; do the same with the returned member after successful creation. Change landing heading to “Who are you?” and helper to “Choose your name to manage your wants and offer cards to friends.” Keep adding a name secondary, with “New here? Add your name.” In `GalleryApp .identity`, label the actor select “You are” and replace the static viewed-name field with a separate “Viewing wantlist” member select that navigates without changing actor. Validate stored IDs against loaded members; an invalid ID becomes unselected. Refresh using the newly selected ID, not the previous actor closure in `choose()`.

Under `.hero`, show exactly one context sentence: owner: “Tap a card to change quantities or manage offers.” Other selected member: “Have one of these? Tap a card to offer it to {owner}.” No actor: “Choose your name to make offers or manage your own list.” Direct links remain browsable without choosing. If an unselected visitor opens a card, show an inline “Choose your name” selector above read-only offers; reveal the appropriate owner/editor view only after selection. Do not show an actionable offer form for a null actor. Re-key the editor by want ID and actor ID to prevent one person's draft appearing under another identity.

## 2. Make accepted offers immediately visible and explain partial coverage

**Evidence:** Dark Ritual in `02-gallery-owner.png` shows “2/4 accepted”, without the remaining quantity. `04-sheet-owner-accept.png` shows the pre-accept row. Source: `app/ui.tsx:107`, `224`, `243–251` stores a Want object separately from the refreshed list; `618–636` updates only the list after acceptance; `640–669` renders the offer editor regardless of acceptance. The stale-sheet and frozen-editor issues are source-derived, not actions performed against the demo.

**Problem:** After accepting, the sheet can still show the old open offer. Friends can attempt edits that the accepted state disallows. “Accepted” can look like all copies are covered even when half are still needed.

**Exact fix:** Store `openWantId` in `GalleryApp` and derive the displayed want from the latest `list.wants`; if removed, close and announce “This card was removed from the list.” In `Sheet`, put an accepted summary immediately after the title: “Accepted from {name} · {qty} of {needed} copies · HK${total} total”. For partial acceptance add “{remaining} copies still needed. Only one offer can be accepted at a time.” Owner helper: “Replace this offer or clear acceptance to reopen offers.” Offerer helper: “Offers are paused while this offer is accepted.”

Render the accepted row first with visible “Accepted”; dim other rows and label them “Not selected · offers paused”. Hide new-offer and edit/withdraw controls whenever `acceptedOfferId` exists; still show all offers and preserve the group's deletion rules. Give owners “Clear acceptance” with inline copy “Reopen offers for this card?” and buttons “Clear acceptance” / “Keep accepted”. Use the existing clear-acceptance route. For a different offer use “Replace with {name}”; expand an inline comparison of old/new quantities and totals, with “Replace accepted offer” / “Cancel”. Keep initial acceptance one explicit click, disable its button during the request, then announce “Accepted {qty} copies from {name}.” Catch errors beside that action. Keep the one-accepted-offer rule even for partial quantities.

## 3. Give the card sheet a complete, readable action hierarchy

**Evidence:** `04-sheet-owner-accept.png` has a title, need count and one accept row, but no owner quantity/removal controls. `03-sheet-offerer.png` puts the existing offer above the visitor's fields. `app/ui.tsx:604–670` contains no owner quantity editor, want removal or offer withdrawal control; rows show unit price but no extended total. `.offer-list article`, `app/globals.css:298–315`, distributes content across generic columns.

**Problem:** Owners cannot finish ordinary list maintenance from the place where the contract tells them to act. Friends must calculate totals and scan somebody else's offer before finding their own task. Destructive actions need to be available without competing with acceptance.

**Exact fix:** Structure `Sheet` as `.sheet-header` (card name, set/collector, “{owner}'s wantlist”), `.sheet-body`, and a status/action region. For owners, show “Copies wanted” with an integer input, 500ms autosave and adjacent save status; below it show “Offers ({count})”. Reject decreases below any active offer quantity inline: “An offer is for {qty} copies. Change or remove that offer before reducing this quantity.” Do not silently reduce offers.

For offerers, put “Your offer to {owner}” and their editor before “Other offers ({count})”; show their own saved row as “You”. Each offer row must read “{name} · {qty} copies”, “HK${unit} each · HK${extended} total”, then status and the owner accept action. Use decimal/cents formatting with two places. Give accept buttons the acid fill and dark text; keep Close and secondary actions neutral. Place an open offer's “Withdraw my offer” below its editor, with inline “Withdraw your offer for {card}?” / “Withdraw offer” / “Keep offer”.

At the bottom use a collapsed “Remove…” area for the permitted want/offer deletions, available to any selected member under the trust contract. Want confirmation: “Remove {card} and its {count} offers from {owner}'s list?” with “Remove card” / “Keep card”. Accepted-offer deletion must say “Removing this accepted offer will reopen offers for this card.” Quantity editing remains owner-only. Connect these controls to existing routes and retain drafts on failed requests; do not introduce native dialogs.

## 4. Make HKD offer entry obvious and autosave trustworthy

**Evidence:** `03-sheet-offerer.png` places `~US$4.32 (TCG mkt)` on a full-width line below both fields and shows `0.00` as the price placeholder. `app/ui.tsx:544–586`, `642–668`: initial creation requires “Make offer”, subsequent edits debounce; creation closes the sheet; closing unmounts local drafts. `docs/PLAN.md:271` specifies valid-input creation and draft retention.

**Problem:** Users may copy the USD number into HKD, mistake a placeholder for a free offer, or leave unsure whether typing saved anything. Closing before the debounce can lose work. The two save models are unexplained.

**Exact fix:** Label fields “Copies you can offer” and “Your price per copy (HKD)”; retain quantity default 1, show “Up to {needed}”, use a visible `HK$` prefix, and change price placeholder to “Enter price”. Put `.reference-price` directly inside the price field group: “Reference only: ~US${usd} (TCG mkt)”; below it, “Enter your own HKD price. Enter 0 for a free offer.” Never convert or prefill. Keep null/loading states, add “Retry reference” on failed lookup, and let users enter offers without the reference.

Follow the specified autosave model for both creation and edits: after 500ms with valid quantity and a deliberately entered valid price, create once; subsequently update that offer. Replace “Make offer” with persistent copy “Your offer saves automatically.” Show the calculated “{qty} × HK${unit} = HK${total}” and a stable live status: “Not saved — enter a price”, “Saving…”, “Offer saved”, or “Couldn’t save. Your changes are kept.” with Retry. Blank/partial values never become zero. Serialize operations and reuse the request ID for retries of the same operation; do not generate duplicate creations.

Keep drafts and pending saves above the sheet, keyed by actor/want, so Close/Escape/backdrop dismissal does not discard them. Reopening restores the draft and status. When acceptance arrives, preserve but freeze an unsaved draft and explain the pause from item 2; do not keep retrying a now-invalid edit. On stale-list conflicts retain the draft and show current versus drafted values with “Apply my changes” / “Use current values”; never silently reapply.

## 5. Make paste → review → add understandable

**Evidence:** `05-import-sheet.png` shows only a placeholder example and “Review import”. `app/ui.tsx:159–168` hides import until owner identity is selected; `716–741` has no textarea label, then exposes “Staged”, “absolute target”, “persistent queue” and “Commit matched cards”. Proposed quantity rows omit card names. `docs/PLAN.md:203–207` defines additive merging and durable staged lines.

**Problem:** Friends do not know what to paste, whether reviewing already adds cards, or which quantity they are approving. Technical wording obscures the common task of adding a deck export to a wantlist.

**Exact fix:** Keep “Import list” visible in the own-list toolbar once item 1 establishes identity. In `ImportSheet`, show “Import to {owner}'s wantlist” and a real textarea label “Paste cards from Moxfield, Archidekt, or a text list”. Add helper “One card per line, starting with a quantity. Existing cards get the pasted quantities added.” Show examples outside the placeholder: `4 Lightning Bolt` and `4x Lightning Bolt (M11) 149`. Label the first action “Review cards”; disable while empty or pending, and show “Checking card names…”.

Render review as “{matched} cards ready · {issues} lines need a match · {ignored} lines skipped”. Count distinct proposed printings for cards and physical lines for issues/skips. Each `.report` row must include canonical card name, set/collector and “Have {current} + adding {imported} = {target} copies”. For this staged import keep the computed target read-only, matching the commit contract; quantity corrections remain available in the owner sheet. Replace the primary action with “Add {matched} cards to my list”; helper: “Matched cards will be added. Unmatched lines stay here for you to fix later.” With no matches, show “No cards ready to add” and “Review unmatched lines”, not an empty commit action.

On duplicate input show “You imported this text before. Importing again adds these quantities again.” with “Import again” / “Back to paste”. If the user edits text after review, invalidate the old report and require a fresh review with a new staging request ID; retain the ID for retries of unchanged text. Closing after staging must refresh the durable issue count and say “Review saved. Cards are added only when you choose Add.” After commit keep a result view: “Added {copies} copies across {cards} cards. {issues} lines still need a match.” Offer “Fix {issues} lines” when applicable and “Back to wantlist”.

## 6. Turn unknown-card repair into a small, named task

**Evidence:** `app/ui.tsx:178–205` renders every repair form directly above the gallery, including Ignore without confirmation. `407–472` displays raw text, “Absolute target” and “Resolve line”, but omits `line.reason`. `.repair-line` at `app/globals.css:251` has fixed minimum columns without a mobile override. Repair is not shown in the provided screenshots; these are source findings.

**Problem:** A typo turns into unfamiliar data-entry work and can overwhelm the gallery. Users cannot tell why a line failed or whether the entered quantity adds copies or replaces a total. Non-owners see repair controls they cannot use successfully.

**Exact fix:** Replace the expanded gallery forms with `.repair-summary`: “{count} imported lines need a match” and, for the owner, “Fix matches”. Open a repair sheet showing a vertical list of issues. Others see “{owner} has {count} imported lines to match” without owner-only repair controls; keep permitted ignore/removal available through the secondary management area for selected members.

Each `RepairLine` shows original line number/text, its reason in plain language, and “Find the correct card” autocomplete. A selected match must show canonical name, set and collector number before applying. Use “Total copies after adding this line” instead of “Absolute target”, with “Already on your list: {current} · From this line: {contribution} · New total: {target}”. Missing quantities require explicit entry rather than silently adding zero. Button: “Use this card”. After success remove that issue and announce “Matched {card}. {remaining} lines left.” Clear the selected match whenever its search text changes.

Rename Ignore to “Skip this line”; inline confirmation says “Skip ‘{original}’? No cards will be added from this line.” with “Skip line” / “Keep line”. Distinguish lookup outages (“Couldn’t check this card. Try again.”) from unmatched names (“No matching card found. Search for the correct name.”). Use the existing durable repair operation and consumed-line semantics; retain the selected match on error. At narrow widths `.repair-line` becomes one column with full-width inputs.

## 7. Keep mobile sheets usable with a keyboard and long content

**Evidence:** Desktop captures `03-sheet-offerer.png`, `04-sheet-owner-accept.png`, `05-import-sheet.png` show compact centered panels, not mobile proof. Source: `.sheet` uses `max-height:90vh`, padding 28px and a floated Close (`app/globals.css:276–287`); `.editor` has two unconstrained columns (`309–315`). Only `Sheet` focuses itself and handles Escape (`app/ui.tsx:539–599`); AddCard/ImportSheet lack equivalent behavior and none traps/returns focus.

**Problem:** On a phone, the keyboard and scroll can hide feedback or Close; long names and fields can squeeze the panel. Keyboard users can move focus behind an ostensibly modal sheet.

**Exact fix:** Use one shared dialog shell for card, add, import and repair sheets. Give it a labelled `.sheet-header` with a non-floated Close button, independently scrolling `.sheet-body`, and visible `.sheet-status` for the current save/action. Lock background scroll while open, make background content inert, trap Tab/Shift+Tab, support Escape, and return focus to the opener. If the opener disappeared, focus the gallery heading. Preserve drafts as in item 4.

Below 600px use full width, top-only 16px corners, 16px body padding, `max-height:calc(100dvh - 8px)` and bottom padding including `env(safe-area-inset-bottom)`. Size against the visible viewport when the software keyboard reduces it; keep the focused field and its validation in view. Set grid children `min-width:0`; below 400px make `.editor` one column. Inputs use at least 16px type and controls at least 44px height. Let offer rows wrap full names and show the action on its own row where needed. Preserve the desktop centered dialog and locked two-column phone gallery. Verify 320px and 390px with the keyboard open, long names, ten offers and a long import report; no horizontal scrolling or inaccessible final action.

## 8. Make loading, empty and failure states tell people what to do

**Evidence:** `app/ui.tsx:38–44` starts with an empty member array; `112–126` has no visible failure handling for members/refresh; `230–233` gives the same “Pick your identity, then import” instruction to everyone; `286–342` autocomplete lacks loading/no-results feedback. `02-gallery-owner.png` has blank lower image areas, while later captures contain those images; this does not establish an image-load failure. `Tile` has an error fallback, but no name while loading (`489–499`).

**Problem:** A slow connection looks like missing data. Visitors are told to import into somebody else's list. Failed actions can appear to do nothing, and stale content can look current.

**Exact fix:** Add explicit loading/error/empty branches to `Picker`: “Loading names…”, “Couldn’t load names.” + “Try again”, and “No members yet. Add your name to start.” Preserve entered names on failure and disable repeated member submission while pending. In `GalleryApp`, owner-empty copy is “Your wantlist is empty.” with primary “Import list” and secondary “Add one card”; another member sees “{owner} hasn’t added any cards yet.” with “View my wantlist”; an unselected visitor sees “This wantlist is empty.” with “Choose your name”.

Keep the last successful gallery on background read failure and show “Couldn’t refresh this list. Showing the last update.” + Retry. First-load route failures need a useful retry view and “Back to member picker”, without replacing errors with an empty list. In `CardChooser` show “Searching…”, then “No matches. Check the spelling.” only after a successful empty response; clear stale results/error text when query changes. On failure show “Couldn’t search cards.” + Retry.

In `Tile`, render a canonical-name placeholder beneath the image until `onLoad`, retaining it on error; hide the failed image. Keep aspect ratio and actions intact. Ensure sticker placement does not cover the fallback name. Use `role="status"` for progress/success and an inline alert for failed explicit actions; error messages must retain inputs and offer a real retry action. Apply this same pending/error treatment to accept, clear, removal, repair and import, not just the existing offer save path.

## 9. Improve glanceable quantities while matching the sticker reference

**Evidence:** `02-gallery-owner.png` has small bottom labels, “1 offers”, a tiny accepted label and noticeably inset card art. Compare `refs/mockup.png`'s large rounded white-halo names and edge-filling images. Source: `.tile img,.placeholder` both receive 15px padding (`app/globals.css:150–159`); stickers use viewport-relative font sizing and unlimited wrapping (`191–223`); `.need` is 11px (`229–237`). `app/ui.tsx:476–521` omits remaining copies from accepted labels. Sparse color groups in eight demo wants explain much of the empty horizontal space; do not remove locked grouping to fill it.

**Problem:** The gallery's most useful information is harder to read than its decorative heading. Long stickers can consume card text, and accepted status is buried in the name treatment.

**Exact fix:** Split image and placeholder CSS: `.tile img { padding:0; object-fit:contain; }`; keep padding only for the placeholder. Retain existing grid breakpoints and 8–12px gaps. Reduce `.hero h1` maximum size to 48px and `.hero` bottom margin to 24px; retain the serif style and color sections. Set `.need` to 12px/1.3 with 8px side padding and a compact dark scrim. Copy by state: “Need {qty}”; “Need {qty} · 1 offer” / “Need {qty} · {n} offers”; “{accepted}/{needed} accepted · {remaining} still needed” for partial acceptance; “{needed}/{needed} accepted” for full coverage. Allow two lines on narrow tiles. Do not sum competing offers as coverage. Include the same status and rarity in the tile's accessible name.

Make sticker sizing relative to the tile, targeting 40px at 240px width, clamped to 20–44px; center the cluster at 50% horizontally and approximately 34% vertically. Use weight 900, existing member colors, a rounded 5–6px white halo and multidirectional shadow fallback. Shrink long names to a minimum of 20px, then limit to two lines with ellipsis; full names remain in sheet/accessibility text. Keep two open names plus overflow count; accepted name stays dominant with smaller dim siblings. Move “✓ Accepted” into a separate small high-contrast label outside the name's text stroke. Keep unoffered cards sticker-free. Use CSS text, not new raster art.

Keep the locked total label and explanatory counts. Move the footer into normal page flow after the grid (`position:static`) so it cannot cover cards while scrolling; retain the top remaining-copy summary for glanceable progress. Treat sticker scale, heading size and this footer placement as one visual preview for owner eyes before shipping.

## 10. Make export's contents clear before downloading

**Evidence:** `05-import-sheet.png` shows a generic Export link in the background. `app/ui.tsx:163–168` downloads immediately; `app/api/[...path]/route.ts:85–98` exports resolved wants and appends an unresolved-count comment. No warning is visible before the download. This is source inspection, not an export request.

**Problem:** Someone sharing their list can believe it includes unresolved pasted cards. A generic label does not explain that the output is a text list suitable for reuse.

**Exact fix:** Keep export in the owner toolbar and relabel it “Export .txt”, with helper/title “Download quantities and card names”. When there are no unresolved lines, keep one-click download via the existing GET route and `<qty> <name> (SET)` format. When there are issues, expand an inline toolbar panel first: “{count} unmatched lines won’t be included. Export the {resolvedCount} cards already on your list?” Buttons: “Download matched cards”, “Fix matches”, “Cancel”. “Fix matches” opens item 6's repair sheet. Keep the count comment inside the exported file as a second safeguard. If there are no resolved wants, disable download with “Add or match a card before exporting.” Do not report a completed download merely because the link was clicked.

## Build order

**Safe to batch into one functional implementation pass:** items **1–8 and 10** restore the existing product contract and provide ordinary recovery paths. Within that pass implement identity (1), live sheet data/accepted-state derivation (2), and the shared dialog/draft infrastructure (4, 7) before wiring management (3). Then build the connected import → repair → export sequence (5, 6, 10), applying the shared state treatment (8) throughout. Item 4's initial autosave follows `docs/PLAN.md:271`; it is not a new manual-save workflow. No new auth, trade-state or quantity policy needs deciding.

**Owner eyes first:** item **9**'s exact sticker sizing, heading reduction and normal-flow footer should be previewed at 390px and desktop against `refs/mockup.png` before finalizing. Its correctness fixes—singular offer copy, partial remaining count and accessible state text—can join the functional pass. Owner review is for aesthetic fit, not permission to abandon the locked sticker/gallery contract. Include item 3's action emphasis in that same preview without delaying the missing functional controls.

Validate the implementation on disposable local/demo fixtures: fresh identity → friend's list → saved offer → owner acceptance/replacement/clear; partial coverage; close/reopen during autosave; failed and stale requests; mixed matched/unknown import → repair → export; 320/390px keyboard and focus behavior; image failure and long/multiple names. Mutation-based checks belong off the live site. The present review changed only this document and performed none of those mutations.
