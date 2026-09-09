"use client";
import { useGetServiceReadinessQuery } from "@/lib/api/api";
import { serviceNames, type ServiceName } from "@/lib/api/contracts";
import { useUiStore } from "../providers/state-provider";
import { serviceErrorMessage } from "../services/service-status";
import { AttentionList } from "./attention-list";
import { Card } from "../ui/card";
import { Button, ButtonLink } from "../ui/button";
import { StatusBadge } from "../ui/status-badge";

function Readiness({ service }: { service: ServiceName }) {
  const query = useGetServiceReadinessQuery(service);
  const data = query.currentData?.body;
  const ready = data?.status === "ready" &&
    (service !== "orders" || ("recovery" in data.checks && data.checks.recovery === true));
  const label = query.isFetching ? "Checking" : query.error || !data ? "Unknown" :
    ready ? "Ready" : data.status === "not_ready" ? "Not ready" : "Unknown";
  return <section aria-label={`${service} readiness`} className="readiness-summary">
    <h3>{service === "orders" ? "Order orchestrator" : service[0].toUpperCase() + service.slice(1)}</h3>
    <StatusBadge tone={label === "Ready" ? "success" : label === "Not ready" ? "warning" : "neutral"}>{label}</StatusBadge>
    {query.error && <p>{serviceErrorMessage(query.error)}</p>}
    {label === "Unknown" && !query.error && <p>Required readiness information is unavailable.</p>}
    <Button variant="secondary" disabled={query.isFetching} onClick={() => query.refetch()} aria-label={`Refresh ${service} readiness`}>Refresh</Button>
  </section>;
}

export function Overview() {
  const ids = useUiStore(state => state.recentOrderIds);
  const hydration = useUiStore(state => state.hydration);
  const remember = useUiStore(state => state.rememberRecentOrders);
  return <>
    <Card className="order-panel" aria-label="Service readiness">
      <div className="order-panel-heading"><h2>Service readiness</h2><ButtonLink variant="ghost" href="/services">Full service checks</ButtonLink></div>
      <p>Live readiness snapshots refresh on entry, focus, reconnect, and manual refresh. Each service is checked independently.</p>
      <div className="readiness-grid">{serviceNames.map(service => <Readiness key={service} service={service} />)}</div>
    </Card>
    <AttentionList />
    <Card className="order-panel" aria-label="Recent orders">
      <div className="order-panel-heading"><h2>Recent orders</h2><ButtonLink variant="ghost" href="/orders">Manage recent orders</ButtonLink></div>
      <p>Orders opened or submitted in this browser only. Only order IDs are saved, not customer or delivery details.</p>
      {hydration === "pending" ? <p role="status">Loading recent orders…</p> :
        <>
          {hydration === "unavailable" && <p>Browser storage is unavailable; this list is kept in memory only.</p>}
          {!remember ? <p>History is turned off.</p> : !ids.length ? <p>No recent orders.</p> :
            <ul className="recent-orders">{ids.map(id => <li key={id}><ButtonLink variant="ghost" href={`/orders/${id}`}>{id}</ButtonLink></li>)}</ul>}
        </>}
    </Card>
  </>;
}
