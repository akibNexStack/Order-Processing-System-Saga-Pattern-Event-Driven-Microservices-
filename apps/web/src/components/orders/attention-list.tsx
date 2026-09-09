"use client";
import { useGetAttentionQuery } from "@/lib/api/api";
import { readError } from "@/lib/orders/view";
import { Card } from "../ui/card";
import { Button, ButtonLink } from "../ui/button";
import { StatusBadge } from "../ui/status-badge";

export function AttentionList() {
  const query = useGetAttentionQuery();
  const data = query.currentData?.body;
  return <Card className="order-panel" aria-label="Orders requiring attention">
    <div className="order-panel-heading"><h2>Orders requiring attention</h2>
      <Button variant="secondary" disabled={query.isFetching} onClick={() => query.refetch()}>Refresh attention</Button>
    </div>
    <p>The endpoint returns at most 100 records, newest updates first. This is a limited list, not the total number of orders requiring attention.</p>
    {query.error ? <p role="alert">{readError(query.error)}</p> :
      !data ? <p role="status">Loading attention list…</p> :
      <>
        <p>{data.orders.length} returned · Response limit: {data.limit}{data.orders.length === data.limit ? " · More orders may require attention." : ""}</p>
        {data.orders.length === 0 ? <p>No orders requiring attention were returned by the service.</p> :
          <ul className="attention-orders">{data.orders.map(order => <li key={order.orderId}>
            <p><strong>Order:</strong> {order.orderId}</p>
            <StatusBadge tone={order.status === "FAILED" ? "danger" : order.status === "COMPLETED" ? "success" : "warning"}>{order.status}</StatusBadge>
            <p><strong>Reason:</strong> {order.reason ?? "No reason reported"}</p>
            <p><strong>Current operation:</strong> {order.operation}</p>
            <p><strong>Updated:</strong> <time dateTime={order.updatedAt}>{order.updatedAt}</time></p>
            <div className="order-panel-heading">
              <ButtonLink variant="secondary" href={`/orders/${order.orderId.toLowerCase()}`}>Open order</ButtonLink>
              <ButtonLink variant="ghost" href={`/orders/${order.orderId.toLowerCase()}#order-history`}>View history</ButtonLink>
            </div>
          </li>)}</ul>}
      </>}
    {data && query.isFetching && <p role="status">Refreshing attention list…</p>}
  </Card>;
}
