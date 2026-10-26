"use client";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  FormEvent,
  ReactNode,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import type { Borrow, List, Member, Offer, Trade, Want } from "../lib/client-types";
import { composeBorrowedSections } from "../lib/trades-borrowed";
import { getReferencePrice } from "../lib/reference-price";
import {
  amount,
  aboveTarget,
  finishMismatch,
  ImportReport,
  reviewCounts,
  tileStatus,
  validPrice,
  validQuantity,
  validTargetPrice,
} from "../lib/ux";
import {
  api,
  ApiClientError,
  Draft,
  draftKey,
  ListStore,
  Operation,
  useList,
} from "./use-list";

type Tab = "wantlist" | "trades" | "borrowed";
type TradeCache = { rows: Trade[]; nextCursor: string | null; complete: boolean };
type MemberTabCache = { trades?: TradeCache; borrows?: Borrow[] };
const tabCache = new Map<string, MemberTabCache>();
const activeTab = (value: string | null): Tab =>
  value === "trades" || value === "borrowed" ? value : "wantlist";

export function Picker() {
  const [members, setMembers] = useState<Member[]>([]),
    [name, setName] = useState("");
  const [loading, setLoading] = useState(true),
    [loadError, setLoadError] = useState(false),
    [error, setError] = useState(""),
    [pending, setPending] = useState(false);
  async function load() {
    setLoading(true);
    setLoadError(false);
    try {
      setMembers((await api("/api/members")).members);
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void load();
  }, []);
  async function add(event: FormEvent) {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setError("");
    try {
      const { member } = await api("/api/members", {
        method: "POST",
        body: JSON.stringify({ name }),
      });
      localStorage.setItem("actor", member.id);
      location.href = `/${encodeURIComponent(member.name)}`;
    } catch (error) {
      setError((error as Error).message);
      setPending(false);
    }
  }
  return (
    <div className="picker">
      {loading ? (
        <p role="status">Loading names…</p>
      ) : loadError ? (
        <p role="alert">
          Couldn’t load names. <button onClick={load}>Try again</button>
        </p>
      ) : !members.length ? (
        <p>No members yet. Add your name to start.</p>
      ) : (
        members.map((m) => (
          <Link
            key={m.id}
            href={`/${encodeURIComponent(m.name)}`}
            onClick={() => localStorage.setItem("actor", m.id)}
            style={{ borderColor: m.color }}
          >
            {m.name}
          </Link>
        ))
      )}
      <form onSubmit={add}>
        <label>
          New here? Add your name.
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={40}
            placeholder="Member name"
          />
        </label>
        <button disabled={pending || !name.trim()}>
          {pending ? "Adding…" : "Add name"}
        </button>
      </form>
      {error && (
        <p role="alert" className="error">
          {error}{" "}
          <button disabled={pending} onClick={add}>
            Retry
          </button>
        </p>
      )}
    </div>
  );
}

export function Dialog({
  title,
  subtitle,
  close,
  status,
  children,
}: {
  title: string;
  subtitle?: string;
  close: () => void;
  status?: ReactNode;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null),
    closeRef = useRef(close),
    titleId = useId();
  closeRef.current = close;
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);
  useEffect(() => {
    if (!mounted || !ref.current) return;
    const opener = document.activeElement as HTMLElement | null,
      panel = ref.current;
    const backdrop = panel.parentElement!;
    const siblings = [...document.body.children].filter(
      (el) => el !== backdrop && el instanceof HTMLElement,
    ) as HTMLElement[];
    const prior = siblings.map((el) => el.inert);
    siblings.forEach((el) => {
      el.inert = true;
    });
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    panel.focus();
    const viewport = () => {
      backdrop.style.height = `${window.visualViewport?.height ?? window.innerHeight}px`;
      backdrop.style.top = `${window.visualViewport?.offsetTop ?? 0}px`;
      if (panel.contains(document.activeElement))
        (document.activeElement as HTMLElement)?.scrollIntoView({
          block: "nearest",
        });
    };
    viewport();
    window.visualViewport?.addEventListener("resize", viewport);
    window.visualViewport?.addEventListener("scroll", viewport);
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeRef.current();
      }
      if (event.key !== "Tab") return;
      const items = [
        ...panel.querySelectorAll<HTMLElement>(
          'button:not(:disabled),a[href],input:not(:disabled),select:not(:disabled),textarea:not(:disabled),summary,[tabindex="0"]',
        ),
      ].filter((el) => el.getClientRects().length);
      const first = items[0],
        last = items.at(-1);
      if (!first) {
        event.preventDefault();
        panel.focus();
      } else if (
        event.shiftKey &&
        (document.activeElement === first ||
          document.activeElement === panel ||
          !panel.contains(document.activeElement))
      ) {
        event.preventDefault();
        last!.focus();
      } else if (
        !event.shiftKey &&
        (document.activeElement === last ||
          document.activeElement === panel ||
          !panel.contains(document.activeElement))
      ) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("keydown", key);
      window.visualViewport?.removeEventListener("resize", viewport);
      window.visualViewport?.removeEventListener("scroll", viewport);
      document.body.style.overflow = overflow;
      siblings.forEach((el, i) => {
        el.inert = prior[i];
      });
      (opener?.isConnected
        ? opener
        : document.getElementById("gallery-heading")
      )?.focus();
    };
  }, [mounted]);
  return mounted
    ? createPortal(
        <div
          className="backdrop"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) close();
          }}
        >
          <div
            ref={ref}
            className="sheet"
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            tabIndex={-1}
          >
            <div className="sheet-header">
              <div>
                <h2 id={titleId}>{title}</h2>
                {subtitle && <p>{subtitle}</p>}
              </div>
              <button className="close" onClick={close}>
                Close
              </button>
            </div>
            <div className="sheet-body">{children}</div>
            <div className="sheet-status" role="status">
              {status}
            </div>
          </div>
        </div>,
        document.body,
      )
    : null;
}

function ActorSelect({
  actor,
  members,
  choose,
  label = "You are",
}: {
  actor: string | null;
  members: Member[];
  choose: (id: string) => void;
  label?: string;
}) {
  return (
    <label>
      {label}
      <select value={actor ?? ""} onChange={(e) => choose(e.target.value)}>
        <option value="">Choose your name</option>
        {members.map((m) => (
          <option key={m.id} value={m.id}>
            {m.name}
          </option>
        ))}
      </select>
    </label>
  );
}
const groups = ["White", "Blue", "Black", "Red", "Green", "Multi", "Colorless"];
const rarity: Record<string, number> = {
  mythic: 0,
  rare: 1,
  uncommon: 2,
  common: 3,
};
function group(want: Want) {
  return want.colors.length > 1
    ? "Multi"
    : ((
        { W: "White", U: "Blue", B: "Black", R: "Red", G: "Green" } as Record<
          string,
          string
        >
      )[want.colors[0]] ?? "Colorless");
}
export function GalleryApp({ initial }: { initial: List }) {
  const searchParams = useSearchParams();
  const store = useList(initial),
    { list } = store;
  const [members, setMembers] = useState<Member[]>([]),
    [actor, setActor] = useState<string | null>(null),
    [memberError, setMemberError] = useState(false);
  const [openWantId, setOpenWantId] = useState<string | null>(null),
    [panel, setPanel] = useState<"import" | "add" | "repair" | null>(null),
    [exporting, setExporting] = useState(false),
    [notice, setNotice] = useState(""),
    [tab, setTabState] = useState<Tab>(() => activeTab(searchParams.get("tab"))),
    [cacheVersion, setCacheVersion] = useState(0);
  const owner = actor === list.member.id,
    open = list.wants.find((w) => w.id === openWantId),
    issues = list.unresolvedImports.length;
  async function loadMembers() {
    try {
      const x = await api("/api/members");
      setMembers(x.members);
      const stored = localStorage.getItem("actor");
      const valid = x.members.some((m: Member) => m.id === stored)
        ? stored
        : null;
      if (!valid) localStorage.removeItem("actor");
      setActor(valid);
      setMemberError(false);
      await store.refresh(valid);
    } catch {
      setMemberError(true);
    }
  }
  useEffect(() => {
    void loadMembers();
  }, []);
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === "visible") void store.refresh(actor);
    };
    addEventListener("focus", refresh);
    const timer = setInterval(refresh, 30000);
    return () => {
      removeEventListener("focus", refresh);
      clearInterval(timer);
    };
  }, [actor]);
  useEffect(() => {
    if (openWantId && !open) {
      setOpenWantId(null);
      setNotice("This card was removed from the list.");
    }
  }, [openWantId, open]);
  useEffect(() => setTabState(activeTab(searchParams.get("tab"))), [searchParams]);
  function setTab(next: Tab) {
    setTabState(next);
    const url = new URL(window.location.href);
    if (next === "wantlist") url.searchParams.delete("tab");
    else url.searchParams.set("tab", next);
    window.history.replaceState(window.history.state, "", url);
  }
  function invalidate(...names: ("trades" | "borrows")[]) {
    const cached = tabCache.get(list.member.id);
    if (cached) names.forEach((name) => delete cached[name]);
    setCacheVersion((value) => value + 1);
  }
  function choose(id: string) {
    const valid = members.some((m) => m.id === id) ? id : null;
    if (valid) localStorage.setItem("actor", valid);
    else localStorage.removeItem("actor");
    setActor(valid);
    void store.refresh(valid);
  }
  const exportLink = (
    <a
      className="button"
      title="Download quantities and card names"
      href={`/api/members/${list.member.id}/export`}
    >
      Download matched cards
    </a>
  );
  return (
    <>
      <header>
        <Link href="/" className="brand">
          <span>TRADE</span>
          <b>MTG</b>
        </Link>
        <div className="identity">
          <ActorSelect actor={actor} members={members} choose={choose} />
          <label>
            Viewing wantlist
            <select
              value={list.member.id}
              onChange={(e) => {
                const member = members.find((m) => m.id === e.target.value);
                if (member)
                  location.href = `/${encodeURIComponent(member.name)}${tab === "wantlist" ? "" : `?tab=${tab}`}`;
              }}
            >
              {!members.length && (
                <option value={list.member.id}>{list.member.name}</option>
              )}
              {members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        {owner && tab === "wantlist" && (
          <nav>
            <button className="primary" onClick={() => setPanel("import")}>
              Import list
            </button>
            <button onClick={() => setPanel("add")}>Add one card</button>
            {!list.wants.length ? (
              <button disabled title="Add or match a card before exporting.">
                Export .txt
              </button>
            ) : issues ? (
              <button
                title="Download quantities and card names"
                onClick={() => setExporting(!exporting)}
              >
                Export .txt
              </button>
            ) : (
              <a
                className="button"
                title="Download quantities and card names"
                href={`/api/members/${list.member.id}/export`}
              >
                Export .txt
              </a>
            )}
          </nav>
        )}
      </header>
      <div className="tabs" role="tablist" aria-label="Member page">
        {(["wantlist", "trades", "borrowed"] as const).map((value) => (
          <button
            key={value}
            role="tab"
            aria-selected={tab === value}
            className={tab === value ? "selected" : ""}
            onClick={() => setTab(value)}
          >
            {value[0].toUpperCase() + value.slice(1)}
          </button>
        ))}
      </div>
      {tab === "wantlist" ? (
      <>
      <main className="gallery-main">
        {memberError && (
          <p role="alert">
            Couldn’t load names.{" "}
            <button onClick={loadMembers}>Try again</button>
          </p>
        )}
        {store.readError && (
          <p role="alert">
            Couldn’t refresh this list. Showing the last update.{" "}
            <button onClick={() => store.refresh(actor)}>Retry</button>
          </p>
        )}
        {exporting && owner && (
          <aside className="toolbar-panel">
            <p>
              {issues} unmatched lines won’t be included. Export the{" "}
              {list.wants.length} cards already on your list?
            </p>
            {list.wants.length ? (
              exportLink
            ) : (
              <p>Add or match a card before exporting.</p>
            )}
            <button
              onClick={() => {
                setExporting(false);
                setPanel("repair");
              }}
            >
              Fix matches
            </button>
            <button onClick={() => setExporting(false)}>Cancel</button>
          </aside>
        )}
        {owner && !list.wants.length && (
          <p className="muted">Add or match a card before exporting.</p>
        )}
        <section className="hero">
          <p>WANTLIST · {list.wants.length} PRINTINGS</p>
          <h1 id="gallery-heading" tabIndex={-1}>
            {list.member.name}’s card hunt
          </h1>
          <span>{list.total.remainingCopies} copies still needed</span>
          <p className="context">
            {owner
              ? "Tap a card to change quantities or manage offers."
              : actor
                ? `Have one of these? Tap a card to offer it to ${list.member.name}.`
                : "Choose your name to make offers or manage your own list."}
          </p>
        </section>
        <p role="status">{notice}</p>
        {issues > 0 && (
          <aside className="repair-summary">
            <b>
              {owner
                ? `${issues} imported lines need a match`
                : `${list.member.name} has ${issues} imported lines to match`}
            </b>
            {owner ? (
              <button onClick={() => setPanel("repair")}>Fix matches</button>
            ) : (
              actor && (
                <details>
                  <summary>Remove…</summary>
                  <button onClick={() => setPanel("repair")}>
                    Manage imported lines
                  </button>
                </details>
              )
            )}
          </aside>
        )}
        {groups.map((g) => {
          const cards = list.wants
            .filter((w) => group(w) === g)
            .sort(
              (a, b) =>
                (rarity[a.rarity] ?? 9) - (rarity[b.rarity] ?? 9) ||
                a.cardName.localeCompare(b.cardName),
            );
          return cards.length ? (
            <section className="color-section" key={g}>
              <h2>
                {g}
                <small>{cards.length}</small>
              </h2>
              <div className="grid">
                {cards.map((w) => (
                  <Tile
                    key={w.id}
                    want={w}
                    onClick={() => setOpenWantId(w.id)}
                  />
                ))}
              </div>
            </section>
          ) : null;
        })}
        {!list.wants.length && (
          <div className="empty">
            {owner ? (
              <>
                <p>Your wantlist is empty.</p>
                <button className="primary" onClick={() => setPanel("import")}>
                  Import list
                </button>
                <button onClick={() => setPanel("add")}>Add one card</button>
              </>
            ) : actor ? (
              <>
                <p>{list.member.name} hasn’t added any cards yet.</p>
                <Link
                  className="button"
                  href={`/${encodeURIComponent(members.find((m) => m.id === actor)?.name ?? "")}`}
                >
                  View my wantlist
                </Link>
              </>
            ) : (
              <>
                <p>This wantlist is empty.</p>
                <ActorSelect
                  actor={actor}
                  members={members}
                  choose={choose}
                  label="Choose your name"
                />
              </>
            )}
          </div>
        )}
      </main>
      <footer>
        <b>Total if all accepted: HK${list.total.amountHkd}</b>
        <span>
          Based on offered quantities · {list.total.unpricedCards} cards without
          offers · {list.total.remainingCopies} copies still needed
        </span>
      </footer>
      </>
      ) : tab === "trades" ? (
        <TradesTab
          member={list.member}
          actor={actor}
          members={members}
          cacheVersion={cacheVersion}
          refreshList={() => store.refresh(actor)}
          invalidateBorrowed={() => invalidate("borrows")}
        />
      ) : (
        <BorrowedTab
          member={list.member}
          actor={actor}
          members={members}
          cacheVersion={cacheVersion}
          refreshList={() => store.refresh(actor)}
          invalidateTrades={() => invalidate("trades")}
        />
      )}
      {open && (
        <Sheet
          key={`${open.id}:${actor}`}
          want={open}
          store={store}
          actor={actor}
          members={members}
          choose={choose}
          close={() => setOpenWantId(null)}
          onTradeDone={(wantId) => {
            store.resetWantDrafts(wantId);
            invalidate("trades", "borrows");
            setNotice("Saved");
          }}
        />
      )}
      {panel === "add" && owner && (
        <AddCard store={store} actor={actor!} close={() => setPanel(null)} />
      )}
      {panel === "import" && owner && (
        <ImportSheet
          store={store}
          actor={actor!}
          close={() => setPanel(null)}
          repair={() => setPanel("repair")}
          announce={setNotice}
        />
      )}
      {panel === "repair" && actor && (
        <Dialog
          title="Fix matches"
          close={() => setPanel(null)}
          status={notice}
        >
          {!issues && <p>All imported lines are matched.</p>}
          {list.unresolvedImports.map((line) => (
            <RepairLine
              key={line.id}
              line={line}
              store={store}
              actor={actor}
              announce={setNotice}
            />
          ))}
        </Dialog>
      )}
    </>
  );
}

async function fetchAllTrades(memberId: string) {
  const rows: Trade[] = [];
  let cursor: string | null = null;
  do {
    const result = await api(
      `/api/members/${memberId}/trades?limit=50${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
    );
    rows.push(...result.trades);
    cursor = result.nextCursor;
  } while (cursor);
  return rows;
}
async function fetchMemberRevision(memberId: string) {
  const result = await api("/api/members");
  const member = (result.members as Member[]).find((item) => item.id === memberId);
  if (!member) throw new Error("Member no longer exists");
  return member.revision;
}

function CardThumb({ imageUrl, name }: { imageUrl: string | null; name: string }) {
  const [bad, setBad] = useState(false);
  return imageUrl && !bad ? (
    <img className="row-thumb" src={imageUrl} alt="" loading="lazy" onError={() => setBad(true)} />
  ) : (
    <div className="row-thumb placeholder"><span>{name}</span></div>
  );
}

function TradeStatus({ trade, memberId }: { trade: Trade; memberId: string }) {
  const total = amount(trade.unitPriceHkd, trade.qty);
  return trade.paid ? (
    <span className="status-badge">Paid</span>
  ) : (
    <strong className="debt">{trade.buyerId === memberId ? "Owes" : "Owed"} HK${total}</strong>
  );
}

function TradeRow({
  trade,
  member,
  actor,
  onPaid,
}: {
  trade: Trade;
  member: Member;
  actor: string | null;
  onPaid: (trade: Trade, paid: boolean) => Promise<void>;
}) {
  const [pending, setPending] = useState(false), [error, setError] = useState("");
  const canToggle = actor === member.id || actor === trade.counterparty.id;
  async function toggle(paid: boolean, done: () => void) {
    if (!actor || pending) return;
    setPending(true);
    setError("");
    try {
      await onPaid(trade, paid);
      done();
    } catch (e) {
      setError(e instanceof ApiClientError && e.status === 409
        ? "This trade changed elsewhere. The latest state has been loaded."
        : (e as Error).message);
    } finally { setPending(false); }
  }
  return (
    <article className="history-row">
      <CardThumb imageUrl={trade.imageUrl} name={trade.cardName} />
      <div className="row-card"><b>{trade.cardName}</b><span>{trade.setCode.toUpperCase()} · #{trade.collectorNo} · {trade.finish}</span></div>
      <span>{trade.qty} × HK${amount(trade.unitPriceHkd)} = <b>HK${amount(trade.unitPriceHkd, trade.qty)}</b></span>
      <span>with <b style={{ color: trade.counterparty.color }}>{trade.counterparty.name}</b></span>
      <time dateTime={trade.finishedAt}>{new Date(trade.finishedAt).toLocaleDateString()}</time>
      <div className="row-actions">
        <TradeStatus trade={trade} memberId={member.id} />
        {canToggle ? (
          <ConfirmAction
            label={trade.paid ? "Mark unpaid" : "Mark paid"}
            question={trade.paid ? "Mark this trade unpaid again?" : "Confirm this trade has been paid?"}
            keep="Cancel"
          >
            {(done) => <button disabled={pending} onClick={() => void toggle(!trade.paid, done)}>{pending ? "Saving…" : trade.paid ? "Mark unpaid" : "Mark paid"}</button>}
          </ConfirmAction>
        ) : <small>{actor ? "Only the buyer or seller can update payment." : "Choose the buyer or seller to update payment."}</small>}
        {error && <p role="alert" className="error">{error}</p>}
      </div>
    </article>
  );
}

function TradesTab({ member, actor, cacheVersion, refreshList, invalidateBorrowed }: {
  member: Member; actor: string | null; members: Member[]; cacheVersion: number;
  refreshList: () => Promise<List | undefined>; invalidateBorrowed: () => void;
}) {
  const [data, setData] = useState<TradeCache | undefined>(() => tabCache.get(member.id)?.trades);
  const [loading, setLoading] = useState(!data), [error, setError] = useState(""), [more, setMore] = useState(false);
  async function load(reset = false) {
    const current = reset ? undefined : tabCache.get(member.id)?.trades;
    if (current) { setData(current); setLoading(false); return; }
    setLoading(true); setError("");
    try {
      const result = await api(`/api/members/${member.id}/trades?limit=50`);
      const next = { rows: result.trades as Trade[], nextCursor: result.nextCursor as string | null, complete: !result.nextCursor };
      tabCache.set(member.id, { ...tabCache.get(member.id), trades: next });
      setData(next);
    } catch (e) { setError((e as Error).message); } finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, [member.id, cacheVersion]);
  async function loadMore() {
    if (!data?.nextCursor || more) return;
    setMore(true); setError("");
    try {
      const result = await api(`/api/members/${member.id}/trades?limit=50&cursor=${encodeURIComponent(data.nextCursor)}`);
      const next = { rows: [...data.rows, ...result.trades], nextCursor: result.nextCursor, complete: !result.nextCursor };
      tabCache.set(member.id, { ...tabCache.get(member.id), trades: next }); setData(next);
    } catch (e) { setError((e as Error).message); } finally { setMore(false); }
  }
  async function paid(trade: Trade, value: boolean) {
    if (!actor) return;
    try {
      const expectedRevision = await fetchMemberRevision(trade.buyerId);
      await api(`/api/offers/${trade.sourceOfferId}/paid`, { method: "PATCH", body: JSON.stringify({ paid: value, actorMemberId: actor, requestId: crypto.randomUUID(), expectedRevision }) });
    } finally {
      await refreshList();
      tabCache.set(member.id, { ...tabCache.get(member.id), trades: undefined });
      invalidateBorrowed();
      await load(true);
    }
  }
  return <main className="list-main"><section className="list-hero"><p>FINISHED TRADES</p><h1>{member.name}’s trades</h1></section>
    {loading && <p role="status">Loading trades…</p>}
    {error && <p role="alert" className="error">{error} <button onClick={() => void load(true)}>Try again</button></p>}
    {!loading && !data?.rows.length && <div className="empty"><p>No finished trades yet — mark an accepted offer done from a wantlist.</p></div>}
    <div className="history-list">{data?.rows.map((trade) => <TradeRow key={trade.id} trade={trade} member={member} actor={actor} onPaid={paid} />)}</div>
    {data?.nextCursor && <button disabled={more} onClick={() => void loadMore()}>{more ? "Loading…" : "Load more"}</button>}
  </main>;
}

function BorrowRow({ row, member, actor, onChange }: { row: Borrow; member: Member; actor: string | null; onChange: () => Promise<void> }) {
  const [pending, setPending] = useState(false), [message, setMessage] = useState(""), [error, setError] = useState("");
  const returned = row.status === "returned";
  async function toggle() {
    if (!actor || pending) return;
    setPending(true); setError(""); setMessage("Saving…");
    try {
      const expectedRevision = await fetchMemberRevision(row.borrowerId);
      await api(`/api/borrows/${row.id}`, { method: "PATCH", body: JSON.stringify({ status: returned ? "outstanding" : "returned", actorMemberId: actor, requestId: crypto.randomUUID(), expectedRevision }) });
      setMessage("Saved"); await onChange();
    } catch (e) { setError(e instanceof ApiClientError && e.status === 409 ? "This entry changed elsewhere. The latest state has been loaded." : (e as Error).message); await onChange(); }
    finally { setPending(false); }
  }
  return <article className={`history-row ${returned ? "returned" : ""}`}>
    <CardThumb imageUrl={row.imageUrl} name={row.cardName} /><div className="row-card"><b>{row.cardName}</b><span>{row.qty} {row.qty === 1 ? "copy" : "copies"}</span></div>
    <span>{row.borrowerId === member.id ? "from" : "to"} <b style={{ color: row.otherParty.color }}>{row.otherParty.name}</b></span>
    <time dateTime={row.createdAt}>{new Date(row.createdAt).toLocaleDateString()}</time>
    <div className="row-actions"><span className="status-badge">{returned ? "Returned" : "Outstanding"}</span>
      {actor ? <button disabled={pending} onClick={() => void toggle()}>{pending ? "Saving…" : returned ? "Mark outstanding" : "Mark returned"}</button> : <small>Choose your name to update.</small>}
      {message && !error && <small role="status">{message}</small>}{error && <p role="alert" className="error">{error}</p>}
    </div>
  </article>;
}

function AddBorrowDialog({ direction: initialDirection, member, members, actor, close, saved }: { direction: "borrowed" | "lent"; member: Member; members: Member[]; actor: string | null; close: () => void; saved: () => Promise<void> }) {
  const [direction, setDirection] = useState(initialDirection), [other, setOther] = useState(""), [card, setCard] = useState<Card>(), [qty, setQty] = useState("1");
  const [pending, setPending] = useState(false), [error, setError] = useState(""), [status, setStatus] = useState("");
  const borrowerId = direction === "borrowed" ? member.id : other, lenderId = direction === "borrowed" ? other : member.id;
  async function submit() {
    if (!actor || !card || !validQuantity(qty) || !other || borrowerId === lenderId || pending) return;
    setPending(true); setError(""); setStatus("Saving…");
    try {
      const expectedRevision = await fetchMemberRevision(borrowerId);
      await api("/api/borrows", { method: "POST", body: JSON.stringify({ borrowerId, lenderId, scryfallId: card.scryfallId, qty: Number(qty), actorMemberId: actor, requestId: crypto.randomUUID(), expectedRevision }) });
      setStatus("Saved"); await saved(); close();
    } catch (e) { setError(e instanceof ApiClientError && e.status === 409 ? "The ledger changed elsewhere. Review the latest entries and try again." : (e as Error).message); }
    finally { setPending(false); }
  }
  return <Dialog title="Add borrow" subtitle="Log a card loan for any two members." close={close} status={status}>
    {!actor && <p role="alert">Choose your name in the top bar before logging a borrow.</p>}
    <fieldset className="segmented-field wide"><legend>Direction</legend><div className="segmented">
      <button className={direction === "borrowed" ? "selected" : ""} onClick={() => { setDirection("borrowed"); setError(""); }}>{member.name} borrowed from</button>
      <button className={direction === "lent" ? "selected" : ""} onClick={() => { setDirection("lent"); setError(""); }}>{member.name} lent to</button>
    </div></fieldset>
    <label>Other member<select value={other} onChange={(e) => setOther(e.target.value)}><option value="">Choose a member</option>{members.filter((item) => item.id !== member.id).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
    <CardChooser onPick={setCard} />{card && <CardIdentity card={card} />}
    <label>Copies<input inputMode="numeric" value={qty} onChange={(e) => setQty(e.target.value)} /></label>
    {borrowerId && borrowerId === lenderId && <p role="alert" className="error">Borrower and lender must be different.</p>}
    {error && <p role="alert" className="error">{error}</p>}
    <button className="primary" disabled={!actor || !card || !other || !validQuantity(qty) || pending} onClick={() => void submit()}>{pending ? "Saving…" : "Add borrow"}</button>
  </Dialog>;
}

function BorrowedTab({ member, actor, members, cacheVersion, refreshList, invalidateTrades }: { member: Member; actor: string | null; members: Member[]; cacheVersion: number; refreshList: () => Promise<List | undefined>; invalidateTrades: () => void }) {
  const [borrows, setBorrows] = useState<Borrow[] | undefined>(() => tabCache.get(member.id)?.borrows), [trades, setTrades] = useState<Trade[] | undefined>(() => tabCache.get(member.id)?.trades?.complete ? tabCache.get(member.id)?.trades?.rows : undefined);
  const [loading, setLoading] = useState(!borrows || !trades), [error, setError] = useState(""), [add, setAdd] = useState<"borrowed" | "lent" | null>(null);
  async function load(force = false) {
    const cached = tabCache.get(member.id);
    setLoading(true); setError("");
    try {
      const [nextBorrows, nextTrades] = await Promise.all([
        !force && cached?.borrows ? cached.borrows : api(`/api/members/${member.id}/borrows`).then((x) => x.borrows as Borrow[]),
        !force && cached?.trades?.complete ? cached.trades.rows : fetchAllTrades(member.id),
      ]);
      tabCache.set(member.id, { borrows: nextBorrows, trades: { rows: nextTrades, nextCursor: null, complete: true } });
      setBorrows(nextBorrows); setTrades(nextTrades);
    } catch (e) { setError((e as Error).message); } finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, [member.id, cacheVersion]);
  async function reloadBorrows() { tabCache.set(member.id, { ...tabCache.get(member.id), borrows: undefined }); await refreshList(); await load(true); }
  async function paid(trade: Trade, value: boolean) {
    if (!actor) return;
    try {
      const expectedRevision = await fetchMemberRevision(trade.buyerId);
      await api(`/api/offers/${trade.sourceOfferId}/paid`, { method: "PATCH", body: JSON.stringify({ paid: value, actorMemberId: actor, requestId: crypto.randomUUID(), expectedRevision }) });
    }
    finally { invalidateTrades(); await refreshList(); await load(true); }
  }
  const sections = composeBorrowedSections(member.id, borrows ?? [], trades ?? []);
  const section = (title: string, direction: "borrowed" | "lent", ledger: Borrow[], debts: Trade[]) => <section className="borrow-section"><div className="section-heading"><h2>{title}</h2><button className="primary" onClick={() => setAdd(direction)}>Add borrow</button></div>
    {!ledger.length && !debts.length && <p className="muted">{direction === "borrowed" ? "No borrowed cards or unpaid purchases." : "No lent cards or unpaid sales."}</p>}
    <div className="history-list">{debts.map((trade) => <TradeRow key={`debt-${trade.id}`} trade={trade} member={member} actor={actor} onPaid={paid} />)}{ledger.map((row) => <BorrowRow key={row.id} row={row} member={member} actor={actor} onChange={reloadBorrows} />)}</div>
  </section>;
  return <main className="list-main"><section className="list-hero"><p>BORROWED LEDGER</p><h1>{member.name}’s cards and debts</h1></section>
    {loading && <p role="status">Loading borrowed cards…</p>}{error && <p role="alert" className="error">{error} <button onClick={() => void load(true)}>Try again</button></p>}
    {!loading && <>{section("Borrowed by me", "borrowed", sections.owes.borrows, sections.owes.trades)}{section("Lent out", "lent", sections.owed.borrows, sections.owed.trades)}</>}
    {add && <AddBorrowDialog direction={add} member={member} members={members} actor={actor} close={() => setAdd(null)} saved={reloadBorrows} />}
  </main>;
}

function Tile({ want, onClick }: { want: Want; onClick: () => void }) {
  const active = want.offers
      .filter((o) => o.status === "open" || o.status === "accepted")
      .sort(
        (a, b) =>
          a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
      ),
    accepted = active.find((o) => o.id === want.acceptedOfferId);
  const shown = accepted
    ? [accepted, ...active.filter((o) => o !== accepted).slice(0, 2)]
    : active.slice(0, 2);
  const [bad, setBad] = useState(false),
    [loaded, setLoaded] = useState(false),
    status = tileStatus(want);
  return (
    <button
      className={`tile ${accepted ? "accepted" : ""}`}
      onClick={onClick}
      aria-label={`${want.cardName}, ${want.rarity}, ${status}${active.length ? `, offers from ${active.map((o) => o.offerer.name).join(", ")}` : ""}`}
    >
      {(!loaded || bad || !want.imageUrl) && (
        <div className="placeholder">
          <span>{want.cardName}</span>
        </div>
      )}
      {!bad && want.imageUrl && (
        <img
          src={want.imageUrl}
          alt=""
          loading="lazy"
          decoding="async"
          onLoad={() => setLoaded(true)}
          onError={() => setBad(true)}
        />
      )}
      <i className={`gem ${want.rarity}`}>{want.rarity}</i>
      {want.foilPref !== "either" && (
        <small className="finish-pref-badge">
          {want.foilPref === "foil" ? "FOIL" : "NON"}
        </small>
      )}
      {active.length > 0 && (
        <div className="stickers">
          {shown.map((o) => (
            <span
              key={o.id}
              className={accepted && o !== accepted ? "dim" : ""}
              style={{
                color: o.offerer.color,
                fontSize:
                  accepted && o !== accepted
                    ? "20px"
                    : `clamp(20px, ${Math.min(16.67, 240 / Math.max(14.4, o.offerer.name.length))}cqw, 44px)`,
              }}
            >
              {o.offerer.name}
            </span>
          ))}
          {active.length > shown.length && (
            <small>+{active.length - shown.length} offers</small>
          )}
        </div>
      )}
      {accepted && <small className="accepted-label">✓ Accepted</small>}
      <div className="need">{status}</div>
    </button>
  );
}

// Explicit actions retain their operation object, including the original request ID, on retry.
function Action({
  store,
  actor,
  operation,
  label,
  success,
  onSuccess,
  onStatus,
  primary = false,
}: {
  store: ListStore;
  actor: string;
  operation: () => Operation;
  label: string;
  success?: string;
  onSuccess?: () => void;
  onStatus?: (message: string) => void;
  primary?: boolean;
}) {
  const [pending, setPending] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    op = useRef<Operation | null>(null);
  async function run() {
    if (pending) return;
    setPending(true);
    setError("");
    onStatus?.("Saving?");
    op.current ??= operation();
    try {
      await store.mutate(op.current, actor);
      op.current = null;
      setMessage(success ?? "Saved");
      onStatus?.(success ?? "Saved");
      onSuccess?.();
    } catch (e) {
      setError((e as Error).message);
      onStatus?.(`Couldn?t save. ${(e as Error).message}`);
      if (e instanceof ApiClientError && e.status === 409) op.current = null;
    } finally {
      setPending(false);
    }
  }
  return (
    <div className="action">
      <button
        className={primary ? "primary" : ""}
        disabled={pending}
        onClick={run}
      >
        {pending ? "Saving…" : error ? `Retry: ${label}` : label}
      </button>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {message && <p role="status">{message}</p>}
    </div>
  );
}
function ConfirmAction({
  question,
  label,
  keep,
  children,
}: {
  question: string;
  label: string;
  keep: string;
  children: (done: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return open ? (
    <div className="inline-confirm">
      <p>{question}</p>
      {children(() => setOpen(false))}
      <button onClick={() => setOpen(false)}>{keep}</button>
    </div>
  ) : (
    <button onClick={() => setOpen(true)}>{label}</button>
  );
}

function DraftStatus({
  draft,
  store,
  want,
}: {
  draft: Draft;
  store: ListStore;
  want: Want;
}) {
  const mine = want.offers.find(
    (o) => o.offerer.id === draft.actor && o.status !== "withdrawn" && o.status !== "done",
  );
  const blocked =
    draft.kind === "quantity" &&
    validQuantity(draft.qty) &&
    want.offers.find(
      (o) => o.status !== "withdrawn" && o.status !== "done" && o.qty > Number(draft.qty),
    );
  const invalid = !validQuantity(
    draft.qty,
    draft.kind === "offer" ? want.qty : 9999,
  );
  const invalidTarget =
    draft.kind === "quantity" && !validTargetPrice(draft.targetPrice);
  const paused = draft.kind === "offer" && !!want.acceptedOfferId;
  return (
    <div className="draft-status">
      {blocked ? (
        <p role="alert">
          An offer is for {blocked.qty} copies. Change or remove that offer
          before reducing this quantity.
        </p>
      ) : invalid ? (
        <p role="alert">
          Enter a whole number from 1 to{" "}
          {draft.kind === "offer" ? want.qty : 9999}.
        </p>
      ) : invalidTarget ? (
        <p role="alert">Enter a target from HK$0 to HK$99999999.99, or leave it blank.</p>
      ) : (
        <span role={draft.status.startsWith("Couldn") ? "alert" : "status"}>
          {paused
            ? "Offers are paused while this offer is accepted."
            : draft.status ||
              (draft.kind === "offer" && !validPrice(draft.price)
                ? "Not saved — enter a price"
                : "Saving…")}
        </span>
      )}
      {draft.conflict && (
        <div className="inline-confirm">
          <p>
            Current:{" "}
            {draft.kind === "quantity"
              ? `${want.qty} copies`
              : mine
                ? `${mine.qty} copies · HK$${mine.unitPriceHkd} each`
                : "No offer"}
            . Your draft: {draft.qty} copies
            {draft.kind === "offer" && ` · HK$${draft.price} each`}.
          </p>
          <button disabled={paused} onClick={() => store.resolve(draft, true)}>
            Apply my changes
          </button>
          <button onClick={() => store.resolve(draft, false)}>
            Use current values
          </button>
        </div>
      )}
      {!draft.conflict && draft.status.startsWith("Couldn") && !paused && (
        <button onClick={() => store.save(draftKey(draft.actor, want.id))}>
          Retry
        </button>
      )}
    </div>
  );
}
function OfferEditor({
  want,
  store,
  actor,
}: {
  want: Want;
  store: ListStore;
  actor: string;
}) {
  const draft = store.getDraft(want, actor),
    mine = want.offers.find(
      (o) => o.offerer.id === actor && o.status !== "withdrawn" && o.status !== "done",
    );
  const [usd, setUsd] = useState<string | null | undefined>(),
    [failed, setFailed] = useState(false),
    [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    setFailed(false);
    setUsd(undefined);
    getReferencePrice(want.scryfallId)
      .then((x) => {
        if (active) setUsd(x.value);
      })
      .catch(() => {
        if (active) {
          setFailed(true);
          setUsd(null);
        }
      });
    return () => {
      active = false;
    };
  }, [want.scryfallId, attempt]);
  return (
    <section>
      <h3>Your offer to {store.list.member.name}</h3>
      <div className="editor">
        <label>
          Copies you can offer
          <input
            inputMode="numeric"
            value={draft.qty}
            onChange={(e) => store.edit(draft, "qty", e.target.value)}
          />
          <small>Up to {want.qty}</small>
        </label>
        <label>
          Your price per copy (HKD)
          <span className="money-input">
            <span>HK$</span>
            <input
              inputMode="decimal"
              value={draft.price}
              placeholder="Enter price"
              onChange={(e) => store.edit(draft, "price", e.target.value)}
            />
          </span>
          <span className="reference-price">
            {usd === undefined
              ? "Reference loading…"
              : usd === null
                ? "USD reference unavailable"
                : `Reference only: ~US$${usd} (TCG mkt)`}
          </span>
          {failed && (
            <button onClick={() => setAttempt((x) => x + 1)}>
              Retry reference
            </button>
          )}
          <small>Enter your own HKD price. Enter 0 for a free offer.</small>
        </label>
        <fieldset className="segmented-field">
          <legend>Finish</legend>
          <div className="segmented">
            {(["foil", "non-foil"] as const).map((finish) => (
              <button
                key={finish}
                type="button"
                className={draft.finish === finish ? "selected" : ""}
                aria-pressed={draft.finish === finish}
                onClick={() => store.edit(draft, "finish", finish)}
              >
                {finish === "foil" ? "Foil" : "Non-foil"}
              </button>
            ))}
          </div>
        </fieldset>
      </div>
      {want.targetPriceHkd !== null && (
        <p className="target-guidance">Buyer expects ≤ HK${amount(want.targetPriceHkd)}</p>
      )}
      {validPrice(draft.price) && aboveTarget(draft.price, want.targetPriceHkd) && (
        <p className="price-warning">⚠ Above buyer target — you can still save this offer.</p>
      )}
      <p>Your offer saves automatically.</p>
      {validQuantity(draft.qty, want.qty) && validPrice(draft.price) && (
        <p>
          {draft.qty} × HK${amount(draft.price)} = HK$
          {amount(draft.price, Number(draft.qty))}
        </p>
      )}
      <DraftStatus draft={draft} store={store} want={want} />
      {mine && (
        <ConfirmAction
          label="Withdraw my offer"
          question={`Withdraw your offer for ${want.cardName}?`}
          keep="Keep offer"
        >
          {(done) => (
            <Action
              store={store}
              actor={actor}
              label="Withdraw offer"
              operation={() => ({
                url: `/api/offers/${mine.id}`,
                method: "PATCH",
                data: { status: "withdrawn" },
              })}
              onSuccess={() => {
                store.resolve({ ...draft, qty: "1", price: "" }, false);
                done();
              }}
            />
          )}
        </ConfirmAction>
      )}
    </section>
  );
}
function OfferFlags({ want, offer }: { want: Want; offer: Offer }) {
  const mismatch = finishMismatch(want.foilPref, offer.finish);
  const expensive =
    offer.status === "open" && aboveTarget(offer.unitPriceHkd, want.targetPriceHkd);
  return (
    <small className="offer-flags">
      <span className="finish-badge">{offer.finish === "foil" ? "F" : "N"}</span>
      <span>{offer.finish === "foil" ? "foil" : "non-foil"}</span>
      {mismatch && (
        <span className="finish-warning" title={`Buyer prefers ${want.foilPref}`} aria-label={`Finish mismatch: buyer prefers ${want.foilPref}`}>
          ⚠
        </span>
      )}
      {expensive && <span className="price-warning">⚠ Above buyer target</span>}
    </small>
  );
}
function MarkDoneDialog({ want, offer, store, actor, close, complete }: { want: Want; offer: Offer; store: ListStore; actor: string; close: () => void; complete: (wantId: string) => void }) {
  const [paid, setPaid] = useState<boolean | null>(null), [pending, setPending] = useState(false), [error, setError] = useState(""), [status, setStatus] = useState("");
  async function submit() {
    if (paid === null || pending) return;
    setPending(true); setError(""); setStatus("Saving…");
    try {
      await store.mutate({ url: `/api/offers/${offer.id}/done`, method: "POST", data: { paid } }, actor);
      store.resetWantDrafts(want.id);
      await store.refresh(actor);
      setStatus("Saved"); complete(want.id); close();
    } catch (e) {
      setError(e instanceof ApiClientError && e.status === 409 ? "This trade changed elsewhere. The latest wantlist has been loaded." : (e as Error).message);
      await store.refresh(actor);
    } finally { setPending(false); }
  }
  return <Dialog title="Mark trade done" subtitle={`${want.cardName} · ${offer.qty} ${offer.qty === 1 ? "copy" : "copies"}`} close={close} status={status}>
    <div className="trade-summary"><p><b>Counterparty</b> {offer.offerer.name}</p><p><b>Unit price</b> HK${amount(offer.unitPriceHkd)}</p><p><b>Total</b> HK${amount(offer.unitPriceHkd, offer.qty)}</p></div>
    <fieldset className="payment-choice"><legend>Payment</legend>
      <label><input type="radio" name="paid" checked={paid === true} onChange={() => setPaid(true)} /> Paid now</label>
      <label><input type="radio" name="paid" checked={paid === false} onChange={() => setPaid(false)} /> Pay later</label>
    </fieldset>
    <p className="muted">Finishing deducts up to {offer.qty} copies from the wantlist. This cannot be undone.</p>
    {error && <p role="alert" className="error">{error}</p>}
    <button className="primary" disabled={paid === null || pending} onClick={() => void submit()}>{pending ? "Saving…" : "Mark trade done"}</button>
  </Dialog>;
}
function Sheet({
  want,
  store,
  actor,
  members,
  choose,
  close,
  onTradeDone,
}: {
  want: Want;
  store: ListStore;
  actor: string | null;
  members: Member[];
  choose: (id: string) => void;
  close: () => void;
  onTradeDone: (wantId: string) => void;
}) {
  const owner = actor === store.list.member.id,
    active = want.offers.filter((o) => o.status === "open" || o.status === "accepted"),
    accepted = active.find((o) => o.id === want.acceptedOfferId);
  const draft = actor ? store.getDraft(want, actor) : null;
  const [notice, setNotice] = useState(""), [finishing, setFinishing] = useState(false);
  return (
    <Dialog
      title={want.cardName}
      subtitle={`${want.setCode.toUpperCase()} · #${want.collectorNo} · ${store.list.member.name}'s wantlist`}
      close={close}
      status={
        notice ||
        (draft?.dirty
          ? draft.status || "Your changes are kept while this sheet is closed."
          : `Need ${want.qty} copies`)
      }
    >
      {accepted && (
        <section className="accepted-summary">
          <b>
            Accepted from {accepted.offerer.name} · {accepted.qty} of {want.qty}{" "}
            copies · HK${amount(accepted.unitPriceHkd, accepted.qty)} total
          </b>
          {accepted.qty < want.qty && (
            <p>
              {want.qty - accepted.qty} copies still needed. Only one offer can
              be accepted at a time.
            </p>
          )}
          <p>
            {owner
              ? "Replace this offer or clear acceptance to reopen offers."
              : "Offers are paused while this offer is accepted."}
          </p>
          {actor === store.list.member.id || actor === accepted.offerer.id ? (
            <button className="primary" onClick={() => setFinishing(true)}>Mark trade done</button>
          ) : actor ? (
            <p className="muted">Only the buyer or seller can mark this trade done.</p>
          ) : (
            <p className="muted">Choose the buyer or seller above to mark this trade done.</p>
          )}
          {owner && (
            <ConfirmAction
              label="Clear acceptance"
              question="Reopen offers for this card?"
              keep="Keep accepted"
            >
              {(done) => (
                <Action
                  onStatus={setNotice}
                  store={store}
                  actor={actor!}
                  label="Clear acceptance"
                  operation={() => ({
                    url: `/api/wants/${want.id}/clear-acceptance`,
                    method: "POST",
                    data: { expectedAcceptedOfferId: accepted.id },
                  })}
                  onSuccess={() => {
                    done();
                    setNotice("Offers reopened.");
                  }}
                />
              )}
            </ConfirmAction>
          )}
        </section>
      )}
      {!actor && (
        <ActorSelect
          actor={actor}
          members={members}
          choose={choose}
          label="Choose your name"
        />
      )}
      {owner && draft && (
        <section>
          <div className="editor owner-editor">
            <label>
              Copies wanted
              <input
                inputMode="numeric"
                value={draft.qty}
                onChange={(e) => store.edit(draft, "qty", e.target.value)}
              />
            </label>
            <label>
              Target price (HKD)
              <span className="money-input">
                <span>HK$</span>
                <input
                  inputMode="decimal"
                  placeholder="No limit"
                  value={draft.targetPrice}
                  onChange={(e) => store.edit(draft, "targetPrice", e.target.value)}
                />
              </span>
              <small>Optional. Blank means no limit.</small>
            </label>
            <fieldset className="segmented-field wide">
              <legend>Foil preference</legend>
              <div className="segmented three">
                {(["foil", "non-foil", "either"] as const).map((pref) => (
                  <button
                    key={pref}
                    type="button"
                    className={draft.foilPref === pref ? "selected" : ""}
                    aria-pressed={draft.foilPref === pref}
                    onClick={() => store.edit(draft, "foilPref", pref)}
                  >
                    {pref === "foil" ? "Foil" : pref === "non-foil" ? "Non-foil" : "Either"}
                  </button>
                ))}
              </div>
            </fieldset>
          </div>
          <DraftStatus draft={draft} store={store} want={want} />
        </section>
      )}
      {actor && !owner && !accepted && (
        <OfferEditor want={want} store={store} actor={actor} />
      )}
      {accepted && draft?.dirty && !owner && (
        <DraftStatus draft={draft} store={store} want={want} />
      )}
      {actor &&
        !owner &&
        !accepted &&
        active
          .filter((o) => o.offerer.id === actor)
          .map((o) => (
            <div className="offer-list" key={o.id}>
              <article>
                <b>You ? {o.qty} copies</b>
                <span>
                  HK${amount(o.unitPriceHkd)} each ? HK$
                  {amount(o.unitPriceHkd, o.qty)} total
                </span>
                <OfferFlags want={want} offer={o} />
                <em>Open</em>
              </article>
            </div>
          ))}
      <h3>
        {owner || !actor
          ? `Offers (${active.length})`
          : `Other offers (${active.filter((o) => o.offerer.id !== actor).length})`}
      </h3>
      <div className="offer-list">
        {[...active]
          .filter((o) => owner || !actor || accepted || o.offerer.id !== actor)
          .sort(
            (a, b) =>
              Number(b.id === accepted?.id) - Number(a.id === accepted?.id) ||
              Number(b.offerer.id === actor) - Number(a.offerer.id === actor),
          )
          .map((o) => (
            <article
              key={o.id}
              className={accepted && o !== accepted ? "not-selected" : ""}
            >
              <b
                style={{
                  color: `color-mix(in srgb, ${o.offerer.color} 55%, white)`,
                }}
              >
                {o.offerer.id === actor && !owner ? "You" : o.offerer.name} ·{" "}
                {o.qty} copies
              </b>
              <span>
                HK${amount(o.unitPriceHkd)} each · HK$
                {amount(o.unitPriceHkd, o.qty)} total
              </span>
              <OfferFlags want={want} offer={o} />
              <em>
                {o === accepted
                  ? "Accepted"
                  : accepted
                    ? "Not selected · offers paused"
                    : "Open"}
              </em>
              {owner &&
                o !== accepted &&
                (accepted ? (
                  <ConfirmAction
                    label={`Replace with ${o.offerer.name}`}
                    question={`Replace ${accepted.offerer.name}: ${accepted.qty} copies · HK$${amount(accepted.unitPriceHkd, accepted.qty)} total with ${o.offerer.name}: ${o.qty} copies · HK$${amount(o.unitPriceHkd, o.qty)} total?`}
                    keep="Cancel"
                  >
                    {(done) => (
                      <Action
                        onStatus={setNotice}
                        store={store}
                        actor={actor!}
                        label="Replace accepted offer"
                        primary
                        operation={() => ({
                          url: `/api/offers/${o.id}/accept`,
                          method: "POST",
                          data: { expectedAcceptedOfferId: accepted.id },
                        })}
                        onSuccess={() => {
                          done();
                          setNotice(
                            `Accepted ${o.qty} copies from ${o.offerer.name}.`,
                          );
                        }}
                      />
                    )}
                  </ConfirmAction>
                ) : (
                  <Action
                    onStatus={setNotice}
                    store={store}
                    actor={actor!}
                    label="Accept"
                    primary
                    operation={() => ({
                      url: `/api/offers/${o.id}/accept`,
                      method: "POST",
                      data: { expectedAcceptedOfferId: null },
                    })}
                    onSuccess={() =>
                      setNotice(
                        `Accepted ${o.qty} copies from ${o.offerer.name}.`,
                      )
                    }
                  />
                ))}
            </article>
          ))}
      </div>
      {!active.length && <p>No offers yet.</p>}
      {actor && (
        <details className="management">
          <summary>Remove…</summary>
          <ConfirmAction
            label="Remove card"
            question={`Remove ${want.cardName} and its ${want.offers.length} offers from ${store.list.member.name}'s list?`}
            keep="Keep card"
          >
            {() => (
              <Action
                onStatus={setNotice}
                store={store}
                actor={actor}
                label="Remove card"
                operation={() => ({
                  url: `/api/wants/${want.id}`,
                  method: "DELETE",
                  data: {},
                })}
              />
            )}
          </ConfirmAction>
          {active.map((o) => (
            <ConfirmAction
              key={o.id}
              label={`Remove ${o.offerer.name}'s offer`}
              question={`Remove ${o.offerer.name}'s offer?${o === accepted ? " Removing this accepted offer will reopen offers for this card." : ""}`}
              keep="Keep offer"
            >
              {(done) => (
                <Action
                  onStatus={setNotice}
                  store={store}
                  actor={actor}
                  label="Remove offer"
                  operation={() => ({
                    url: `/api/offers/${o.id}`,
                    method: "DELETE",
                    data: {},
                  })}
                  onSuccess={done}
                />
              )}
            </ConfirmAction>
          ))}
        </details>
      )}
      {finishing && actor && accepted && (
        <MarkDoneDialog
          want={want}
          offer={accepted}
          store={store}
          actor={actor}
          close={() => setFinishing(false)}
          complete={(wantId) => { onTradeDone(wantId); close(); }}
        />
      )}
    </Dialog>
  );
}

type Card = {
  scryfallId: string;
  cardName: string;
  setCode: string;
  collectorNo: string;
};
function CardChooser({
  initial = "",
  onPick,
  label = "Card name",
}: {
  initial?: string;
  onPick: (card: Card | undefined) => void;
  label?: string;
}) {
  const [query, setQuery] = useState(initial),
    [names, setNames] = useState<string[]>([]),
    [state, setState] = useState(""),
    [retry, setRetry] = useState(0),
    [selected, setSelected] = useState(false);
  const generation = useRef(0);
  useEffect(() => {
    if (selected) return;
    setNames([]);
    setState("");
    if (query.trim().length < 2) return;
    const controller = new AbortController();
    setState("Searching…");
    const timer = setTimeout(() => {
      api(`/api/cards/autocomplete?q=${encodeURIComponent(query)}`, {
        signal: controller.signal,
      })
        .then((x) => {
          setNames(x.names);
          setState(x.names.length ? "" : "No matches. Check the spelling.");
        })
        .catch((e) => {
          if (e.name !== "AbortError") setState("Couldn’t search cards.");
        });
    }, 200);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [query, retry, selected]);
  async function choose(name: string) {
    const token = ++generation.current;
    setSelected(true);
    setQuery(name);
    setNames([]);
    setState("Searching…");
    try {
      const x = await api(
        `/api/cards/resolve?name=${encodeURIComponent(name)}`,
      );
      if (token === generation.current) {
        onPick(x.card);
        setState("");
      }
    } catch {
      if (token === generation.current) setState("Couldn’t search cards.");
    }
  }
  return (
    <div className="card-chooser">
      <label>
        {label}
        <input
          value={query}
          onChange={(e) => {
            generation.current++;
            setQuery(e.target.value);
            setSelected(false);
            setNames([]);
            setState("");
            onPick(undefined);
          }}
          autoComplete="off"
        />
      </label>
      {names.length > 0 && (
        <div className="suggestions">
          {names.map((name) => (
            <button key={name} onClick={() => choose(name)}>
              {name}
            </button>
          ))}
        </div>
      )}
      {state && (
        <p role={state.startsWith("Couldn") ? "alert" : "status"}>{state}</p>
      )}
      {state.startsWith("Couldn") && (
        <button
          onClick={() => (selected ? choose(query) : setRetry((n) => n + 1))}
        >
          Retry
        </button>
      )}
    </div>
  );
}
function CardIdentity({
  card,
}: {
  card: Card | ImportReport["proposedItems"][number]["card"];
}) {
  return (
    <p>
      <b>{card.cardName}</b> · {card.setCode.toUpperCase()} · #
      {card.collectorNo}
    </p>
  );
}
function AddCard({
  store,
  actor,
  close,
}: {
  store: ListStore;
  actor: string;
  close: () => void;
}) {
  const [card, setCard] = useState<Card>(),
    [qty, setQty] = useState("1"),
    [status, setStatus] = useState("");
  return (
    <Dialog title="Add one card" close={close} status={status}>
      <CardChooser onPick={setCard} />
      {card && <CardIdentity card={card} />}
      <label>
        Copies to add
        <input
          inputMode="numeric"
          value={qty}
          onChange={(e) => setQty(e.target.value)}
        />
      </label>
      {card && validQuantity(qty) && (
        <Action
          onStatus={setStatus}
          key={`${card.scryfallId}:${qty}`}
          store={store}
          actor={actor}
          label="Add to list"
          primary
          operation={() => ({
            url: `/api/members/${store.list.member.id}/wants`,
            method: "PUT",
            data: {
              items: [
                {
                  scryfallId: card.scryfallId,
                  qty:
                    (store.list.wants.find(
                      (w) => w.scryfallId === card.scryfallId,
                    )?.qty ?? 0) + Number(qty),
                },
              ],
            },
          })}
          onSuccess={close}
        />
      )}
    </Dialog>
  );
}
function RepairLine({
  line,
  store,
  actor,
  announce,
}: {
  line: List["unresolvedImports"][number];
  store: ListStore;
  actor: string;
  announce: (message: string) => void;
}) {
  const [card, setCard] = useState<Card>(),
    [target, setTarget] = useState(""),
    [error, setError] = useState(""),
    [pending, setPending] = useState(false),
    [stale, setStale] = useState(false),
    operation = useRef<Operation | null>(null);
  const owner = actor === store.list.member.id,
    current =
      store.list.wants.find((w) => w.scryfallId === card?.scryfallId)?.qty ?? 0;
  function picked(value: Card | undefined) {
    setCard(value);
    operation.current = null;
    setStale(false);
    setTarget(
      value && line.qty !== null
        ? String(
            (store.list.wants.find((w) => w.scryfallId === value.scryfallId)
              ?.qty ?? 0) + line.qty,
          )
        : "",
    );
  }
  async function repair() {
    if (!card || pending || !validQuantity(target)) return;
    setPending(true);
    announce("Saving?");
    setError("");
    operation.current ??= {
      url: `/api/import-lines/${line.id}`,
      method: "PUT",
      data: { scryfallId: card.scryfallId, absoluteQty: Number(target) },
    };
    try {
      const x = await store.mutate(operation.current, actor);
      announce(
        `Matched ${card.cardName}. ${x.list.unresolvedImports.length} lines left.`,
      );
    } catch (e) {
      setError((e as Error).message);
      announce("Couldn?t save. Your changes are kept.");
      if (e instanceof ApiClientError && e.status === 409) {
        operation.current = null;
        setStale(true);
      }
    } finally {
      setPending(false);
    }
  }
  const reason = /unavailable|outage|lookup failed/i.test(line.reason ?? "")
    ? "Couldn’t check this card. Try again."
    : /match/i.test(line.reason ?? "")
      ? "No matching card found. Search for the correct name."
      : (line.reason ?? "Choose the correct card to add this line.");
  return (
    <section className="repair-line">
      <p>
        Line {line.lineNo}: {line.rawText}
      </p>
      <p>{reason}</p>
      {owner && (
        <>
          <CardChooser
            initial={line.parsedName ?? ""}
            onPick={picked}
            label="Find the correct card"
          />
          {card && (
            <>
              <CardIdentity card={card} />
              <label>
                Total copies after adding this line
                <input
                  inputMode="numeric"
                  value={target}
                  disabled={pending}
                  onChange={(e) => {
                    setTarget(e.target.value);
                    operation.current = null;
                  }}
                />
              </label>
              <p>
                Already on your list: {current} · From this line:{" "}
                {line.qty ?? "Enter a quantity"} · New total:{" "}
                {target || "Enter a total"}
              </p>
              {line.qty === null && (
                <p>
                  This line has no quantity. Enter the total copies explicitly.
                </p>
              )}
              {stale && (
                <p role="alert">
                  The list changed. Current total: {current}; drafted total:{" "}
                  {target}. Review the total before using this card.
                </p>
              )}
              <button
                className="primary"
                disabled={pending || !validQuantity(target)}
                onClick={repair}
              >
                {pending
                  ? "Saving…"
                  : error
                    ? "Retry: Use this card"
                    : "Use this card"}
              </button>
            </>
          )}
        </>
      )}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <details className="management">
        <summary>Remove…</summary>
        <ConfirmAction
          label="Skip this line"
          question={`Skip “${line.rawText}”? No cards will be added from this line.`}
          keep="Keep line"
        >
          {(done) => (
            <Action
              onStatus={announce}
              store={store}
              actor={actor}
              label="Skip line"
              operation={() => ({
                url: `/api/import-lines/${line.id}`,
                method: "DELETE",
                data: {},
              })}
              onSuccess={() => {
                done();
                announce("Line skipped.");
              }}
            />
          )}
        </ConfirmAction>
      </details>
    </section>
  );
}
function ImportSheet({
  store,
  actor,
  close,
  repair,
  announce,
}: {
  store: ListStore;
  actor: string;
  close: () => void;
  repair: () => void;
  announce: (message: string) => void;
}) {
  const [text, setText] = useState(""),
    [report, setReport] = useState<ImportReport>(),
    [error, setError] = useState(""),
    [pending, setPending] = useState(false),
    [committing, setCommitting] = useState(false),
    [duplicate, setDuplicate] = useState(false),
    [result, setResult] = useState<{
      copies: number;
      cards: number;
      issues: number;
    }>();
  const stageId = useRef(crypto.randomUUID()),
    commitOp = useRef<Operation | null>(null),
    staged = useRef(false),
    [stale, setStale] = useState(false);
  const counts = report ? reviewCounts(report) : null;
  async function stage(importAgain = false) {
    setCommitting(false);
    if (pending || !text.trim()) return;
    setPending(true);
    setError("");
    try {
      const x = await store.mutate(
        {
          url: `/api/members/${store.list.member.id}/imports`,
          method: "POST",
          data: { text, importAgain, requestId: stageId.current },
          body: JSON.stringify({
            actorMemberId: actor,
            requestId: stageId.current,
            text,
            importAgain,
          }),
        },
        actor,
      );
      setReport(x);
      setDuplicate(false);
      staged.current = true;
      commitOp.current = null;
      setStale(false);
      await store.refresh(actor);
    } catch (e) {
      if (e instanceof ApiClientError && e.body.duplicateWarning)
        setDuplicate(true);
      else setError((e as Error).message);
    } finally {
      setPending(false);
    }
  }
  async function commit() {
    setCommitting(true);
    if (!report || !counts || pending) return;
    setPending(true);
    setError("");
    commitOp.current ??= {
      url: `/api/members/${store.list.member.id}/wants`,
      method: "PUT",
      data: {},
      body: JSON.stringify({
        actorMemberId: actor,
        requestId: crypto.randomUUID(),
        expectedRevision: report.baseRevision,
        importBatchId: report.batchId,
        resolveLineIds: report.lines
          .filter(
            (l) =>
              l.state === "unresolved" &&
              l.scryfallId &&
              report.proposedItems.some((x) => x.scryfallId === l.scryfallId),
          )
          .map((l) => l.id),
        items: report.proposedItems.map((x) => ({
          scryfallId: x.scryfallId,
          qty: x.targetQty,
        })),
      }),
    };
    try {
      const x = await store.mutate(commitOp.current, actor);
      setResult({
        copies: counts.copies,
        cards: counts.cards,
        issues: x.list.unresolvedImports.length,
      });
    } catch (e) {
      setError((e as Error).message);
      if (e instanceof ApiClientError && e.status === 409) {
        commitOp.current = null;
        setStale(true);
      }
    } finally {
      setPending(false);
    }
  }
  function dismiss() {
    if (staged.current) {
      void store.refresh(actor);
      if (!result)
        announce("Review saved. Cards are added only when you choose Add.");
    }
    close();
  }
  return (
    <Dialog
      title={`Import to ${store.list.member.name}'s wantlist`}
      close={dismiss}
      status={
        pending
          ? "Checking card names…"
          : result
            ? `Added ${result.copies} copies across ${result.cards} cards. ${result.issues} lines still need a match.`
            : staged.current
              ? "Review saved. Cards are added only when you choose Add."
              : ""
      }
    >
      {result ? (
        <>
          <p>
            Added {result.copies} copies across {result.cards} cards.{" "}
            {result.issues} lines still need a match.
          </p>
          {result.issues > 0 && (
            <button onClick={repair}>Fix {result.issues} lines</button>
          )}
          <button onClick={dismiss}>Back to wantlist</button>
        </>
      ) : (
        <>
          <label>
            Paste cards from Moxfield, Archidekt, or a text list
            <textarea
              disabled={pending}
              value={text}
              onChange={(e) => {
                setText(e.target.value);
                setReport(undefined);
                setDuplicate(false);
                setError("");
                stageId.current = crypto.randomUUID();
                commitOp.current = null;
                setStale(false);
              }}
            />
          </label>
          <p>
            One card per line. Quantities are optional and default to 1.
            Existing cards get the pasted quantities added.
          </p>
          <pre>4 Lightning Bolt{"\n"}4x Lightning Bolt (M11) 149</pre>
          <button
            disabled={!text.trim() || pending}
            onClick={() => stage(false)}
          >
            {pending ? "Checking card names…" : "Review cards"}
          </button>
          {duplicate && (
            <div className="inline-confirm">
              <p>
                You imported this text before. Importing again adds these
                quantities again.
              </p>
              <button disabled={pending} onClick={() => stage(true)}>
                Import again
              </button>
              <button onClick={() => setDuplicate(false)}>Back to paste</button>
            </div>
          )}
          {error && (
            <p role="alert" className="error">
              {error}{" "}
              {!report && (
                <button disabled={pending} onClick={() => stage(duplicate)}>
                  Retry
                </button>
              )}
            </p>
          )}
          {report && counts && (
            <div className="report">
              <h3>
                {counts.cards} cards ready · {counts.issues} lines need a match
                · {counts.ignored} lines skipped
              </h3>
              {report.proposedItems.map((x) => (
                <article key={x.scryfallId}>
                  <CardIdentity card={x.card} />
                  <p>
                    Have {x.currentQty} + adding {x.importQty} = {x.targetQty}{" "}
                    copies
                  </p>
                </article>
              ))}
              {report.lines
                .filter((x) => x.state === "unresolved" && !x.scryfallId)
                .map((x) => (
                  <p key={x.id}>
                    Line {x.lineNo}: {x.rawText} — {x.reason}
                  </p>
                ))}
              {stale ? (
                <>
                  <p>
                    The list changed. Review the updated quantities before
                    adding.
                  </p>
                  <button disabled={pending} onClick={() => stage(false)}>
                    Review cards
                  </button>
                </>
              ) : counts.cards > 0 ? (
                <>
                  <p>
                    Matched cards will be added. Unmatched lines stay here for
                    you to fix later.
                  </p>
                  <button
                    className="primary"
                    disabled={pending}
                    onClick={commit}
                  >
                    {pending
                      ? "Adding…"
                      : `Add ${counts.cards} cards to my list`}
                  </button>
                </>
              ) : (
                <>
                  <p>No cards ready to add</p>
                  <button onClick={repair}>Review unmatched lines</button>
                </>
              )}
            </div>
          )}
        </>
      )}
    </Dialog>
  );
}
