"use client";
import Link from "next/link";
import {
  FormEvent,
  ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { List, Member, Want } from "../lib/client-types";
import { getReferencePrice } from "../lib/reference-price";
const requestId = () => crypto.randomUUID();
class ApiClientError extends Error {
  constructor(
    message: string,
    public status: number,
    public body: any,
  ) {
    super(message);
  }
}
async function api(url: string, init?: RequestInit) {
  const r = await fetch(url, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
  const x = await r.json();
  if (!r.ok)
    throw new ApiClientError(
      x.error?.message ?? x.message ?? "Request failed",
      r.status,
      x,
    );
  return x;
}
export function Picker() {
  const [members, setMembers] = useState<Member[]>([]),
    [name, setName] = useState(""),
    [error, setError] = useState("");
  useEffect(() => {
    api("/api/members")
      .then((x) => setMembers(x.members))
      .catch((e) => setError(e.message));
  }, []);
  async function add(e: FormEvent) {
    e.preventDefault();
    try {
      const x = await api("/api/members", {
        method: "POST",
        body: JSON.stringify({ name }),
      });
      location.href = `/${encodeURIComponent(x.member.name)}`;
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <div className="picker">
      {members.map((m) => (
        <Link
          key={m.id}
          href={`/${encodeURIComponent(m.name)}`}
          style={{ borderColor: m.color }}
        >
          {m.name}
        </Link>
      ))}
      <form onSubmit={add}>
        <label>
          Add your name
          <input
            value={name}
            maxLength={40}
            onChange={(e) => setName(e.target.value)}
            placeholder="Member name"
          />
        </label>
        <button>Add member</button>
      </form>
      {error && <p className="error">{error}</p>}
    </div>
  );
}
const groups = [
  "White",
  "Blue",
  "Black",
  "Red",
  "Green",
  "Multi",
  "Colorless",
] as const;
function group(w: Want) {
  if (w.colors.length > 1) return "Multi";
  return (
    ({ W: "White", U: "Blue", B: "Black", R: "Red", G: "Green" } as any)[
      w.colors[0]
    ] ?? "Colorless"
  );
}
const rarity: any = { mythic: 0, rare: 1, uncommon: 2, common: 3 };
export function GalleryApp({ initial }: { initial: List }) {
  const [list, setList] = useState(initial),
    [members, setMembers] = useState<Member[]>([]),
    [actor, setActor] = useState<string | null>(null),
    [open, setOpen] = useState<Want | null>(null),
    [importing, setImporting] = useState(false),
    [adding, setAdding] = useState(false);
  useEffect(() => {
    setActor(localStorage.getItem("actor"));
    api("/api/members").then((x) => setMembers(x.members));
  }, []);
  async function refresh() {
    setList(
      await api(`/api/members/${list.member.id}?actorMemberId=${actor ?? ""}`),
    );
  }
  useEffect(() => {
    const f = () => document.visibilityState === "visible" && refresh();
    addEventListener("focus", f);
    const t = setInterval(f, 30000);
    return () => {
      removeEventListener("focus", f);
      clearInterval(t);
    };
  }, [actor, list.member.id]);
  function choose(id: string) {
    localStorage.setItem("actor", id);
    setActor(id);
    refresh();
  }
  return (
    <>
      <header>
        <Link href="/" className="brand">
          <span>TRADE</span>
          <b>MTG</b>
        </Link>
        <div className="identity">
          <label>
            Acting as
            <select
              value={actor ?? ""}
              onChange={(e) => choose(e.target.value)}
            >
              <option value="">Choose name…</option>
              {members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Viewing list<strong>{list.member.name}</strong>
          </label>
        </div>
        {actor === list.member.id && (
          <nav>
            <button onClick={() => setAdding(true)}>Add card</button>
            <button onClick={() => setImporting(true)}>Import list</button>
            <a
              className="button"
              href={`/api/members/${list.member.id}/export`}
            >
              Export
            </a>
          </nav>
        )}
      </header>
      <main className="gallery-main">
        <section className="hero">
          <p>WANTLIST · {list.wants.length} PRINTINGS</p>
          <h1>{list.member.name}’s card hunt</h1>
          <span>{list.total.remainingCopies} copies still needed</span>
        </section>
        {list.unresolvedImports.length > 0 && (
          <aside className="repair">
            <b>{list.unresolvedImports.length} import issue(s) need repair</b>
            {list.unresolvedImports.map((x) => (
              <RepairLine
                key={x.id}
                line={x}
                list={list}
                actor={actor}
                changed={setList}
              >
                <button
                  onClick={async () => {
                    await api(`/api/import-lines/${x.id}`, {
                      method: "DELETE",
                      body: JSON.stringify({
                        actorMemberId: actor,
                        requestId: requestId(),
                        expectedRevision: list.member.revision,
                      }),
                    });
                    refresh();
                  }}
                >
                  Ignore
                </button>
              </RepairLine>
            ))}
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
                  <Tile key={w.id} want={w} onClick={() => setOpen(w)} />
                ))}
              </div>
            </section>
          ) : null;
        })}
        {!list.wants.length && (
          <div className="empty">
            No cards yet. Pick your identity, then import a list.
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
      {open && (
        <Sheet
          want={open}
          list={list}
          actor={actor}
          close={() => setOpen(null)}
          changed={(x) => {
            setList(x);
          }}
        />
      )}
      {adding && (
        <AddCard
          list={list}
          actor={actor}
          close={() => setAdding(false)}
          changed={(x) => {
            setList(x);
            setAdding(false);
          }}
        />
      )}
      {importing && (
        <ImportSheet
          list={list}
          actor={actor}
          close={() => setImporting(false)}
          changed={(x) => {
            setList(x);
            setImporting(false);
          }}
        />
      )}
    </>
  );
}
function CardChooser({
  initial = "",
  onPick,
}: {
  initial?: string;
  onPick: (card: any) => void;
}) {
  const [query, setQuery] = useState(initial),
    [names, setNames] = useState<string[]>([]),
    [error, setError] = useState("");
  useEffect(() => {
    if (query.trim().length < 2) {
      setNames([]);
      return;
    }
    const c = new AbortController(),
      t = setTimeout(
        () =>
          api(`/api/cards/autocomplete?q=${encodeURIComponent(query)}`, {
            signal: c.signal,
          })
            .then((x) => setNames(x.names))
            .catch((e) => {
              if (e.name !== "AbortError") setError(e.message);
            }),
        200,
      );
    return () => {
      clearTimeout(t);
      c.abort();
    };
  }, [query]);
  async function choose(name: string) {
    setQuery(name);
    setNames([]);
    try {
      const x = await api(
        `/api/cards/resolve?name=${encodeURIComponent(name)}`,
      );
      onPick(x.card);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <div className="card-chooser">
      <label>
        Card name
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          autoComplete="off"
        />
      </label>
      {names.length > 0 && (
        <div className="suggestions">
          {names.map((n) => (
            <button key={n} onClick={() => choose(n)}>
              {n}
            </button>
          ))}
        </div>
      )}
      {error && <small className="error">{error}</small>}
    </div>
  );
}
function AddCard({
  list,
  actor,
  close,
  changed,
}: {
  list: List;
  actor: string | null;
  close: () => void;
  changed: (x: List) => void;
}) {
  const [card, setCard] = useState<any>(),
    [qty, setQty] = useState("1"),
    [status, setStatus] = useState("");
  async function add() {
    if (!card || !/^\d+$/.test(qty) || Number(qty) < 1)
      return setStatus("Choose a card and valid quantity");
    const current =
      list.wants.find((w) => w.scryfallId === card.scryfallId)?.qty ?? 0;
    try {
      const x = await api(`/api/members/${list.member.id}/wants`, {
        method: "PUT",
        body: JSON.stringify({
          actorMemberId: actor,
          requestId: requestId(),
          expectedRevision: list.member.revision,
          items: [{ scryfallId: card.scryfallId, qty: current + Number(qty) }],
        }),
      });
      changed(x.list);
    } catch (e) {
      setStatus((e as Error).message);
    }
  }
  return (
    <div className="backdrop">
      <div className="sheet" role="dialog" aria-modal="true">
        <button className="close" onClick={close}>
          Close
        </button>
        <h2>Add card</h2>
        <CardChooser onPick={setCard} />
        {card && (
          <p>
            {card.cardName} ({card.setCode.toUpperCase()} #{card.collectorNo})
          </p>
        )}
        <label>
          Copies to add
          <input
            inputMode="numeric"
            value={qty}
            onChange={(e) => setQty(e.target.value)}
          />
        </label>
        <button onClick={add}>Add to list</button>
        <span aria-live="polite">{status}</span>
      </div>
    </div>
  );
}
function RepairLine({
  line,
  list,
  actor,
  changed,
  children,
}: {
  line: List["unresolvedImports"][number];
  list: List;
  actor: string | null;
  changed: (x: List) => void;
  children: ReactNode;
}) {
  const [card, setCard] = useState<any>(),
    [target, setTarget] = useState(""),
    [status, setStatus] = useState("");
  function picked(c: any) {
    setCard(c);
    setTarget(
      String(
        (list.wants.find((w) => w.scryfallId === c.scryfallId)?.qty ?? 0) +
          (line.qty ?? 0),
      ),
    );
  }
  async function repair() {
    if (!card || !/^\d+$/.test(target) || Number(target) < 1) return;
    setStatus("Saving…");
    try {
      const x = await api(`/api/import-lines/${line.id}`, {
        method: "PUT",
        body: JSON.stringify({
          actorMemberId: actor,
          requestId: requestId(),
          expectedRevision: list.member.revision,
          scryfallId: card.scryfallId,
          absoluteQty: Number(target),
        }),
      });
      setStatus("Saved");
      changed(x.list);
    } catch (e) {
      setStatus(`Retry: ${(e as Error).message}`);
    }
  }
  return (
    <div className="repair-line">
      <span>
        Line {line.lineNo}: {line.rawText}
      </span>
      <CardChooser initial={line.parsedName ?? ""} onPick={picked} />
      {card && (
        <>
          <label>
            Absolute target
            <input
              inputMode="numeric"
              value={target}
              onChange={(e) => setTarget(e.target.value)}
            />
          </label>
          <button onClick={repair}>Resolve line</button>
        </>
      )}{" "}
      {children}
      <small aria-live="polite">{status}</small>
    </div>
  );
}
function Tile({ want, onClick }: { want: Want; onClick: () => void }) {
  const active = want.offers.filter((o) => o.status !== "withdrawn"),
    accepted = active.find((o) => o.status === "accepted"),
    shown = accepted
      ? [accepted, ...active.filter((o) => o !== accepted).slice(0, 2)]
      : active.slice(0, 2);
  const [bad, setBad] = useState(false);
  return (
    <button
      className={`tile ${accepted ? "accepted" : ""}`}
      onClick={onClick}
      aria-label={`${want.cardName}, need ${want.qty}, ${active.length} offers`}
    >
      {!bad && want.imageUrl ? (
        <img
          src={want.imageUrl}
          alt=""
          loading="lazy"
          decoding="async"
          onError={() => setBad(true)}
        />
      ) : (
        <div className="placeholder">{want.cardName}</div>
      )}
      <i className={`gem ${want.rarity}`}>{want.rarity}</i>
      <div className="stickers">
        {shown.map((o, i) => (
          <span
            key={o.id}
            className={i > 0 && accepted ? "dim" : ""}
            style={{ color: o.offerer.color }}
          >
            {o.offerer.name}
            {o === accepted && <em> ✓ accepted</em>}
          </span>
        ))}
        {active.length > shown.length && (
          <small>+{active.length - shown.length} offers</small>
        )}
      </div>
      <div className="need">
        {accepted
          ? `${accepted.qty}/${want.qty} accepted`
          : active.length
            ? `Need ${want.qty} · ${active.length} offers`
            : `Need ${want.qty}`}
      </div>
    </button>
  );
}
function Sheet({
  want,
  list,
  actor,
  close,
  changed,
}: {
  want: Want;
  list: List;
  actor: string | null;
  close: () => void;
  changed: (x: List) => void;
}) {
  const ref = useRef<HTMLDivElement>(null),
    owner = actor === list.member.id,
    mine = want.offers.find(
      (o) => o.offerer.id === actor && o.status !== "withdrawn",
    ),
    [qty, setQty] = useState(String(mine?.qty ?? 1)),
    [price, setPrice] = useState(mine?.unitPriceHkd ?? ""),
    [status, setStatus] = useState(""),
    [usd, setUsd] = useState<string | null | undefined>();
  const revision = useRef(list.member.revision), queue = useRef<Promise<void>>(Promise.resolve());
  useEffect(()=>{revision.current=list.member.revision},[list.member.revision]);
  useEffect(() => {
    const c = new AbortController();
    getReferencePrice(want.scryfallId, c.signal)
      .then((x) => setUsd(x.value))
      .catch(() => setUsd(null));
    ref.current?.focus();
    return () => c.abort();
  }, [want.scryfallId]);
  const valid = /^\d+$/.test(qty)&&Number(qty)>=1&&Number(qty)<=want.qty&&/^\d+(?:\.\d{1,2})?$/.test(price);
  async function persist(method:"POST"|"PUT") {
    if (!actor) return setStatus("Choose your identity first");
    if (!valid)
      return setStatus("Enter a valid quantity and HKD price");
    setStatus("Saving…");
    try {
      const url = method==="PUT" ? `/api/offers/${mine!.id}` : `/api/wants/${want.id}/offers`,
        x = await api(url, {
          method,
          body: JSON.stringify({
            actorMemberId: actor,
            offererId: actor,
            requestId: requestId(),
            expectedRevision: revision.current,
            qty: Number(qty),
            unitPriceHkd: price,
          }),
        });
      setStatus("Saved");
      revision.current=x.revision;
      changed(x.list);
      if(method==="POST")close();
    } catch (e) {
      setStatus(`Retry: ${(e as Error).message}`);
    }
  }
  function enqueue(){queue.current=queue.current.then(()=>persist("PUT"));return queue.current}
  useEffect(()=>{if(!mine||!valid||qty===String(mine.qty)&&price===mine.unitPriceHkd)return;setStatus("Saving…");const t=setTimeout(()=>{void enqueue()},500);return()=>clearTimeout(t)},[qty,price,mine?.id]);
  return (
    <div
      className="backdrop"
      onMouseDown={(e) => e.target === e.currentTarget && close()}
    >
      <div
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-label={want.cardName}
        tabIndex={-1}
        ref={ref}
        onKeyDown={(e) => e.key === "Escape" && close()}
      >
        <button className="close" onClick={close}>
          Close
        </button>
        <p className="eyebrow">
          {want.setCode.toUpperCase()} · #{want.collectorNo}
        </p>
        <h2>{want.cardName}</h2>
        <p>Need {want.qty} copies</p>
        <div className="offer-list">
          {want.offers
            .filter((o) => o.status !== "withdrawn")
            .map((o) => (
              <article key={o.id}>
                <b style={{ color: o.offerer.color }}>{o.offerer.name}</b>
                <span>
                  {o.qty} × HK${o.unitPriceHkd}
                </span>
                {owner && o.status === "open" && (
                  <button
                    onClick={async () => {
                      const x = await api(`/api/offers/${o.id}/accept`, {
                        method: "POST",
                        body: JSON.stringify({
                          actorMemberId: actor,
                          requestId: requestId(),
                          expectedRevision: list.member.revision,
                          expectedAcceptedOfferId: want.acceptedOfferId,
                        }),
                      });
                      changed(x.list);
                    }}
                  >
                    {want.acceptedOfferId ? "Replace accepted" : "Accept"}
                  </button>
                )}
                <em>{o.status}</em>
              </article>
            ))}
        </div>
        {!owner && (
          <div className="editor">
            <label>
              Quantity
              <input
                inputMode="numeric"
                value={qty}
                onChange={(e) => setQty(e.target.value)}
              />
            </label>
            <label>
              HKD per copy
              <input
                inputMode="decimal"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                placeholder="0.00"
              />
            </label>
            <small>
              {usd === undefined
                ? "Reference loading…"
                : usd === null
                  ? "USD reference unavailable"
                  : `~US$${usd} (TCG mkt)`}
            </small>
            {!mine&&<button onClick={()=>persist("POST")}>Make offer</button>}
            {mine&&status.startsWith("Retry:")&&<button onClick={enqueue}>Retry</button>}
            <span aria-live="polite">{status}</span>
          </div>
        )}
      </div>
    </div>
  );
}
function ImportSheet({
  list,
  actor,
  close,
  changed,
}: {
  list: List;
  actor: string | null;
  close: () => void;
  changed: (x: List) => void;
}) {
  const [text, setText] = useState(""),
    [report, setReport] = useState<any>(),
    [error, setError] = useState(""),
    [duplicate,setDuplicate]=useState(false),
    stageId=useRef(requestId());
  async function stage(importAgain=false) {
    try {
      const x = await api(`/api/members/${list.member.id}/imports`, {
        method: "POST",
        body: JSON.stringify({
          actorMemberId: actor,
          requestId: stageId.current,
          text,
          importAgain,
        }),
      });
      setReport(x);
      setDuplicate(false);setError("");
    } catch (e) {
      if(e instanceof ApiClientError&&e.body.duplicateWarning){setDuplicate(true);setError(e.message)}else setError((e as Error).message);
    }
  }
  function target(scryfallId:string,value:string){setReport((r:any)=>({...r,proposedItems:r.proposedItems.map((x:any)=>x.scryfallId===scryfallId?{...x,targetQty:value}:x)}))}
  async function commit(){const items=report.proposedItems.map((x:any)=>({scryfallId:x.scryfallId,qty:Number(x.targetQty)}));if(items.some((x:any)=>!Number.isInteger(x.qty)||x.qty<1))return setError("Enter valid absolute targets");const resolveLineIds=report.lines.filter((l:any)=>l.state==="unresolved"&&l.scryfallId&&items.some((x:any)=>x.scryfallId===l.scryfallId)).map((l:any)=>l.id);try{const x=await api(`/api/members/${list.member.id}/wants`,{method:"PUT",body:JSON.stringify({actorMemberId:actor,requestId:requestId(),expectedRevision:report.baseRevision,importBatchId:report.batchId,resolveLineIds,items})});changed(x.list)}catch(e){setError((e as Error).message)}}
  return (
    <div className="backdrop">
      <div className="sheet import" role="dialog" aria-modal="true">
        <button className="close" onClick={close}>
          Close
        </button>
        <p className="eyebrow">PASTE A LIST</p>
        <h2>Import cards</h2>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="4x Lightning Bolt (M11) 149"
        />
        <button onClick={()=>stage(false)}>Review import</button>
        {error && <p className="error">{error}</p>}
        {duplicate&&<button onClick={()=>stage(true)}>Import again</button>}
        {report && (
          <div className="report">
            <b>Staged {report.lines.length} lines</b>
            {report.lines.map((x: any) => (
              <p key={x.id}>
                Line {x.lineNo}: {x.parsedName ?? x.rawText} —{" "}
                {x.reason ?? "Ready for card resolution"}
              </p>
            ))}
            <p>
              Exact cards can now be repaired from the persistent queue. No
              unknown line was added as a want.
            </p>
            {report.proposedItems.map((x:any)=><label key={x.scryfallId}>Matched {x.importQty} (current {x.currentQty}); absolute target<input inputMode="numeric" value={x.targetQty} onChange={e=>target(x.scryfallId,e.target.value)}/></label>)}
            {report.proposedItems.length>0&&<button onClick={commit}>Commit matched cards</button>}
            <p>Unmatched and malformed lines remain in the repair queue.</p>
          </div>
        )}
      </div>
    </div>
  );
}
