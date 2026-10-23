"use client";
import { useEffect, useRef, useState } from "react";
import type { List, Want } from "../lib/client-types";
import { serialQueue, validPrice, validQuantity } from "../lib/ux";
export class ApiClientError extends Error {
  constructor(
    message: string,
    public status: number,
    public body: any,
  ) {
    super(message);
  }
}
export async function api(url: string, init?: RequestInit) {
  const response = await fetch(url, {
    ...init,
    headers: { "content-type": "application/json", ...init?.headers },
    cache: "no-store",
  });
  const body = await response.json();
  if (!response.ok)
    throw new ApiClientError(
      body.error?.message ?? body.message ?? "Request failed",
      response.status,
      body,
    );
  return body;
}
export type Operation = {
  url: string;
  method: string;
  data: Record<string, unknown>;
  body?: string;
};
export type Draft = {
  actor: string;
  wantId: string;
  kind: "offer" | "quantity";
  qty: string;
  price: string;
  dirty: boolean;
  status: string;
  conflict?: boolean;
  operation?: Operation;
  operationVersion?: number;
  version: number;
};
export const draftKey = (actor: string, want: string) => `${actor}:${want}`;
export function useList(initial: List) {
  const [list, setList] = useState(initial),
    latest = useRef(initial);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({}),
    draftRef = useRef(drafts);
  const [readError, setReadError] = useState(false);
  const queue = useRef(serialQueue()),
    saving = useRef(new Set<string>());
  function changed(next: List) {
    if (next.member.revision < latest.current.member.revision) return;
    latest.current = next;
    setList(next);
  }
  function update(key: string, value: Draft) {
    draftRef.current = { ...draftRef.current, [key]: value };
    setDrafts(draftRef.current);
  }
  async function refresh(actor?: string | null) {
    try {
      const next = await api(
        `/api/members/${initial.member.id}?actorMemberId=${actor ?? ""}`,
      );
      changed(next);
      setReadError(false);
      return next as List;
    } catch {
      setReadError(true);
      return undefined;
    }
  }
  function mutate(operation: Operation, actor: string) {
    return queue.current(async () => {
      operation.body ??= JSON.stringify({
        ...operation.data,
        actorMemberId: actor,
        requestId: crypto.randomUUID(),
        expectedRevision: latest.current.member.revision,
      });
      try {
        const result = await api(operation.url, {
          method: operation.method,
          body: operation.body,
        });
        if (result.list) changed(result.list);
        else if (
          typeof result.baseRevision === "number" ||
          typeof result.revision === "number"
        ) {
          // Staging also advances the list revision. Reconcile before releasing
          // the queue so the next save cannot use the pre-stage revision.
          await refresh(actor);
        }
        return result;
      } catch (error) {
        if (error instanceof ApiClientError && error.status === 409)
          await refresh(actor);
        throw error;
      }
    });
  }
  function getDraft(want: Want, actor: string): Draft {
    const mine = want.offers.find(
      (o) => o.offerer.id === actor && o.status !== "withdrawn",
    );
    const retained = draftRef.current[draftKey(actor, want.id)];
    if (retained?.dirty) return retained;
    return {
      actor,
      wantId: want.id,
      kind: actor === list.member.id ? "quantity" : "offer",
      qty: String(actor === list.member.id ? want.qty : (mine?.qty ?? 1)),
      price: mine?.unitPriceHkd ?? "",
      dirty: false,
      status:
        actor === list.member.id
          ? "Saved"
          : mine
            ? "Offer saved"
            : "Not saved — enter a price",
      version: retained?.version ?? 0,
    };
  }
  function edit(draft: Draft, field: "qty" | "price", value: string) {
    update(draftKey(draft.actor, draft.wantId), {
      ...draft,
      [field]: value,
      dirty: true,
      version: draft.version + 1,
      status: "",
      operation: draft.operation,
    });
  }
  async function save(key: string) {
    let draft = draftRef.current[key];
    if (!draft || draft.conflict || saving.current.has(key)) return;
    const want = latest.current.wants.find((w) => w.id === draft.wantId);
    if (!want || (draft.kind === "offer" && want.acceptedOfferId)) return;
    if (
      !validQuantity(draft.qty, draft.kind === "offer" ? want.qty : 9999) ||
      (draft.kind === "offer" && !validPrice(draft.price))
    )
      return;
    if (
      draft.kind === "quantity" &&
      want.offers.some(
        (o) => o.status !== "withdrawn" && o.qty > Number(draft.qty),
      )
    )
      return;
    const mine = want.offers.find(
      (o) => o.offerer.id === draft.actor && o.status !== "withdrawn",
    );
    const operation =
      draft.operation ??
      (draft.kind === "quantity"
        ? {
            url: `/api/members/${list.member.id}/wants`,
            method: "PUT",
            data: {
              items: [{ scryfallId: want.scryfallId, qty: Number(draft.qty) }],
            },
          }
        : {
            url: mine
              ? `/api/offers/${mine.id}`
              : `/api/wants/${want.id}/offers`,
            method: mine ? "PUT" : "POST",
            data: {
              offererId: draft.actor,
              qty: Number(draft.qty),
              unitPriceHkd: draft.price,
            },
          });
    const version = draft.operationVersion ?? draft.version;
    saving.current.add(key);
    update(key, {
      ...draft,
      operation,
      operationVersion: version,
      status: "Saving…",
    });
    try {
      await mutate(operation, draft.actor);
      draft = draftRef.current[key];
      update(key, {
        ...draft,
        operation: undefined,
        operationVersion: undefined,
        dirty: draft.version !== version,
        status:
          draft.version === version
            ? draft.kind === "offer"
              ? "Offer saved"
              : "Saved"
            : "",
      });
    } catch (error) {
      draft = draftRef.current[key];
      const conflict = error instanceof ApiClientError && error.status === 409;
      update(key, {
        ...draft,
        operation: conflict ? undefined : operation,
        operationVersion: conflict ? undefined : version,
        conflict,
        status: "Couldn’t save. Your changes are kept.",
      });
    } finally {
      saving.current.delete(key);
    }
  }
  function resolve(draft: Draft, apply: boolean) {
    const key = draftKey(draft.actor, draft.wantId);
    const want = latest.current.wants.find((w) => w.id === draft.wantId);
    if (!want) return;
    const mine = want.offers.find(
      (o) => o.offerer.id === draft.actor && o.status !== "withdrawn",
    );
    update(key, {
      ...draft,
      qty: apply
        ? draft.qty
        : String(draft.kind === "quantity" ? want.qty : (mine?.qty ?? 1)),
      price: apply ? draft.price : (mine?.unitPriceHkd ?? ""),
      conflict: false,
      operation: undefined,
      operationVersion: undefined,
      dirty: apply,
      status: apply ? "" : mine ? "Offer saved" : "Not saved — enter a price",
      version: draft.version + 1,
    });
  }
  useEffect(() => {
    const timers = Object.entries(drafts)
      .filter(([, d]) => d.dirty && !d.conflict && !d.status)
      .map(([key]) => setTimeout(() => void save(key), 500));
    return () => timers.forEach(clearTimeout);
  }, [drafts, list]);
  return {
    list,
    changed,
    refresh,
    readError,
    mutate,
    getDraft,
    edit,
    save,
    resolve,
    drafts,
  };
}
export type ListStore = ReturnType<typeof useList>;
