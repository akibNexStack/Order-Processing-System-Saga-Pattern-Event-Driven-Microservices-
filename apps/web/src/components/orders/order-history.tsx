"use client";
import { useEffect, useRef } from "react";
import { useGetOrderHistoryQuery } from "@/lib/api/api";
import { orderedHistory, explainEvent } from "@/lib/orders/progress";
import { manualQueryOptions, readError } from "@/lib/orders/view";
import { Card } from "../ui/card";
import { Button } from "../ui/button";

export function OrderHistory({ orderId, version }: { orderId: string; version: number }) {
  const query = useGetOrderHistoryQuery(orderId, manualQueryOptions);
  const requestedVersion = useRef(version);
  useEffect(() => {
    if (query.isFetching || requestedVersion.current === version) return;
    requestedVersion.current = version;
    void query.refetch();
  }, [version, query.isFetching, query.refetch]);
  const body = query.currentData?.body;
  const events = body ? orderedHistory(body, orderId) : null;
  return <Card className="order-panel" aria-label="Order history">
    <div className="order-panel-heading"><h2>Order history</h2>
      <Button variant="secondary" disabled={query.isFetching || query.isUninitialized} onClick={() => query.refetch()}>Refresh history</Button>
    </div>
    <p>Events in recorded sequence, oldest first. History refreshes when order progress changes and may briefly lag behind the overview.</p>
    {query.error ? <p role="alert">{readError(query.error)}</p> :
      !body ? <p role="status">Loading history…</p> :
      !events ? <p role="alert">Unable to verify this history belongs to the order or has unique event sequences.</p> :
      events.length === 0 ? <p>No history events recorded yet.</p> :
      <ol className="saga-history">{events.map(event => <li key={event.sequence}>
        <p><strong>Event {event.sequence}</strong> · <time dateTime={event.at}>{event.at}</time></p>
        <p>{explainEvent(event)}</p>
        <p>{event.direction === "COMPENSATION" ? "Undoing completed work" : "Order processing"} · {event.from ?? "New order"} → {event.to}</p>
        {event.reason && <p>Reason: {event.reason}</p>}
        <details><summary>Raw event details</summary><pre>{JSON.stringify(event, null, 2)}</pre></details>
      </li>)}</ol>}
    {body && query.isFetching && <p role="status">Refreshing history…</p>}
  </Card>;
}
