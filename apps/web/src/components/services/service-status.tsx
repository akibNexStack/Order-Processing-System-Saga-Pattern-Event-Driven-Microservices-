"use client";

import {
  useGetServiceHealthQuery,
  useGetServiceReadinessQuery,
} from "@/lib/api/api";
import type { ServiceName } from "@/lib/api/contracts";
import { PageHeading } from "@/components/layout/page-heading";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";

const services = [
  {
    id: "orders",
    name: "Order Orchestrator",
    description: "Coordinates the order journey and recovery.",
  },
  {
    id: "payment",
    name: "Payment",
    description: "Handles charges and refunds.",
  },
  {
    id: "inventory",
    name: "Inventory",
    description: "Reserves, releases, and finalizes stock.",
  },
  {
    id: "shipping",
    name: "Shipping",
    description: "Creates and cancels shipments.",
  },
] as const;

function useServiceStatus(service: ServiceName) {
  const health = useGetServiceHealthQuery(service);
  const readiness = useGetServiceReadinessQuery(service);
  return {
    health,
    readiness,
    busy:
      health.isFetching ||
      readiness.isFetching ||
      health.isUninitialized ||
      readiness.isUninitialized,
    refresh: () => {
      void health.refetch();
      void readiness.refetch();
    },
  };
}
type ServiceQueries = ReturnType<typeof useServiceStatus>;

export function serviceErrorMessage(error: unknown): string {
  const status =
    error && typeof error === "object" && "status" in error
      ? error.status
      : undefined;
  if (status === "TIMEOUT_ERROR" || status === 504)
    return "Check timed out. Try refreshing.";
  if (status === 503 || status === "FETCH_ERROR")
    return "Service unavailable. Check the service and its connection, then refresh.";
  if (
    status === "INVALID_RESPONSE" ||
    status === "PARSING_ERROR" ||
    status === 502
  )
    return "Invalid response. The service status could not be verified.";
  return typeof status === "number"
    ? `Check failed (HTTP ${status}). Try refreshing.`
    : "Check failed. Try refreshing.";
}

function CheckTime({
  success,
  attempt,
  failed,
}: {
  success?: number;
  attempt?: number;
  failed: boolean;
}) {
  const time = failed ? attempt : success;
  return (
    <p className="check-time">
      {failed ? "Last attempt" : "Last checked"}:{" "}
      {time ? (
        <time dateTime={new Date(time).toISOString()}>
          {new Date(time).toLocaleString()}
        </time>
      ) : (
        "Not completed yet"
      )}
    </p>
  );
}

function ServiceCard({
  service,
  queries,
}: {
  service: (typeof services)[number];
  queries: ServiceQueries;
}) {
  const { health, readiness, busy, refresh } = queries;
  const healthChecking = health.isFetching || health.isUninitialized;
  const readinessChecking = readiness.isFetching || readiness.isUninitialized;
  // RTK retains older data after errors. Do not render it as the latest result.
  const ready =
    !readinessChecking && !readiness.isError ? readiness.data?.body : undefined;
  const checks = ready && "database" in ready.checks ? ready.checks : undefined;
  const dependencies =
    service.id === "orders"
      ? (["database", "broker", "recovery"] as const)
      : (["database", "broker"] as const);
  const complete =
    !!checks && dependencies.every((key) => typeof checks[key] === "boolean");
  const readinessLabel = readinessChecking
    ? "Checking…"
    : readiness.isError
      ? "Unavailable"
      : ready?.status === "ready"
        ? complete
          ? "Ready"
          : "Incomplete checks"
        : "Not ready";
  return (
    <Card className="service-card" aria-labelledby={`${service.id}-title`}>
      <div className="service-card-top">
        <h2 id={`${service.id}-title`}>{service.name}</h2>
        <Button
          variant="secondary"
          onClick={refresh}
          disabled={busy}
          aria-label={`Refresh ${service.name}`}
        >
          {busy ? "Checking…" : "Refresh"}
        </Button>
      </div>
      <p>{service.description}</p>
      <section
        className="service-check-panel"
        aria-label={`${service.name} health`}
        aria-busy={healthChecking}
      >
        <h3>
          Health <code>/health</code>
        </h3>
        <div role="status">
          <StatusBadge
            tone={
              healthChecking ? "neutral" : health.isError ? "danger" : "success"
            }
          >
            {healthChecking
              ? "Checking…"
              : health.isError
                ? "Unavailable"
                : "Responding"}
          </StatusBadge>
        </div>
        {!healthChecking && health.isError && (
          <p className="service-check-error">
            {serviceErrorMessage(health.error)}
          </p>
        )}
        <CheckTime
          success={health.fulfilledTimeStamp}
          attempt={health.startedTimeStamp}
          failed={health.isError}
        />
      </section>
      <section
        className="service-check-panel"
        aria-label={`${service.name} readiness`}
        aria-busy={readinessChecking}
      >
        <h3>
          Readiness <code>/ready</code>
        </h3>
        <div role="status">
          <StatusBadge
            tone={
              readinessChecking
                ? "neutral"
                : readiness.isError
                  ? "danger"
                  : readinessLabel === "Ready"
                    ? "success"
                    : "warning"
            }
          >
            {readinessLabel}
          </StatusBadge>
        </div>
        {!readinessChecking && readiness.isError && (
          <p className="service-check-error">
            {serviceErrorMessage(readiness.error)}
          </p>
        )}
        {ready && "configured" in ready.checks && (
          <p className="service-check-error">
            Readiness checks are not configured.
          </p>
        )}
        {ready?.status === "ready" && !complete && (
          <p className="service-check-error">
            Required dependency results were not reported.
          </p>
        )}
        <dl className="dependency-checks">
          {dependencies.map((key) => (
            <div key={key}>
              <dt>
                {key === "database"
                  ? "Database"
                  : key === "broker"
                    ? "Broker"
                    : "Order recovery"}
              </dt>
              <dd>
                {checks?.[key] === true
                  ? "Available"
                  : checks?.[key] === false
                    ? "Unavailable"
                    : "Unknown"}
              </dd>
            </div>
          ))}
        </dl>
        <CheckTime
          success={readiness.fulfilledTimeStamp}
          attempt={readiness.startedTimeStamp}
          failed={readiness.isError}
        />
      </section>
    </Card>
  );
}

export function ServiceStatusScreen() {
  const orders = useServiceStatus("orders");
  const payment = useServiceStatus("payment");
  const inventory = useServiceStatus("inventory");
  const shipping = useServiceStatus("shipping");
  const queries = [orders, payment, inventory, shipping];
  const busy = queries.some((query) => query.busy);
  return (
    <>
      <PageHeading
        eyebrow="OPERATIONS"
        title="Services"
        description="Live health and dependency readiness for all four services."
        action={
          <Button
            onClick={() => queries.forEach((query) => query.refresh())}
            disabled={busy}
          >
            {busy ? "Checking services…" : "Refresh all services"}
          </Button>
        }
      />
      <p className="service-status-note">
        Checks run on page entry, refresh, and when the window regains focus or
        reconnects. Results are snapshots, not continuous monitoring. Each
        service is checked independently.
      </p>
      <div className="service-grid">
        {services.map((service, index) => (
          <ServiceCard
            key={service.id}
            service={service}
            queries={queries[index]}
          />
        ))}
      </div>
      <Card className="side-guide">
        <h2>Health and readiness answer different questions</h2>
        <p>
          Health tells you whether a service responds. Readiness checks whether
          its dependencies are available to process work. A responding service
          can still be unready. Unknown means a dependency could not be checked,
          not that it is down.
        </p>
      </Card>
    </>
  );
}
