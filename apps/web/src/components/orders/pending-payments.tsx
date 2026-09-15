"use client";

import { useGetPendingPaymentsQuery } from "@/lib/api/api";
import { readError } from "@/lib/orders/view";
import { Button, ButtonLink } from "../ui/button";
import { Card } from "../ui/card";

function formatAmount(amount: number, currency: string) {
  return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(amount / 100);
}

export function PendingPayments() {
  const query = useGetPendingPaymentsQuery();
  const data = query.currentData?.body;
  return <Card className="order-panel" aria-label="Pending bank-transfer payments">
    <div className="order-panel-heading">
      <div><h2>Pending bank-transfer payments</h2><p>Confirm only after independently checking the transfer reference.</p></div>
      <Button variant="secondary" disabled={query.isFetching} onClick={() => query.refetch()}>Refresh</Button>
    </div>
    {query.error ? <p role="alert">{readError(query.error)}</p> :
      !data ? <p role="status">Loading payment approvals…</p> :
      data.orders.length === 0 ? <p>No bank-transfer payments are waiting for approval.</p> :
        <ul className="attention-orders">
          {data.orders.map(order => <li key={order.orderId}>
            <p><strong>Order:</strong> {order.orderId}</p>
            <p><strong>Amount:</strong> {formatAmount(order.amountMinor, order.currency)}</p>
            <p><strong>Submitted:</strong> <time dateTime={order.createdAt}>{new Date(order.createdAt).toLocaleString()}</time></p>
            <ButtonLink href={`/orders/${order.orderId.toLowerCase()}`}>Review and confirm</ButtonLink>
          </li>)}
        </ul>}
    {data && query.isFetching && <p role="status">Refreshing payment approvals…</p>}
  </Card>;
}
