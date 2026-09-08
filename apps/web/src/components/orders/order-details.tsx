"use client";
import { useEffect, type ReactNode } from "react";
import type { Result } from "@saga/shared/contracts";
import {
  useGetOrderQuery,
  useGetPaymentQuery,
  useGetReservationQuery,
  useGetShipmentQuery,
} from "@/lib/api/api";
import type { ApiResponse } from "@/lib/api/base-query";
import {
  isMissing,
  manualQueryOptions,
  matchesOrder,
  matchesRecords,
  readError,
  sameId,
} from "@/lib/orders/view";
import { demoProducts, formatMinor } from "@/lib/checkout/form";
import { useUiStore } from "../providers/state-provider";
import { SubmissionResult } from "../checkout/submission-result";
import { PageHeading } from "../layout/page-heading";
import { Card } from "../ui/card";
import { Button, ButtonLink } from "../ui/button";
import { StatusBadge } from "../ui/status-badge";

function Fields({ values }: { values: Record<string, ReactNode> }) {
  return (
    <dl className="order-fields">
      {Object.entries(values).map(([label, value]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>{value ?? "—"}</dd>
        </div>
      ))}
    </dl>
  );
}
function ResultView({ result }: { result: Result | null }) {
  if (!result) return <p>No operation result recorded yet.</p>;
  return (
    <div className="operation-result">
      <p>Operation: {result.operation}</p>
      <p>Outcome: {result.outcome}</p>
      {result.outcome === "SUCCEEDED" ? (
        <Fields
          values={Object.fromEntries(
            Object.entries(result.data).map(([key, value]) => [
              (
                {
                  status: "Status",
                  providerTransactionId: "Provider transaction",
                  reservationId: "Reservation ID",
                  providerShipmentId: "Provider shipment",
                } as Record<string, string>
              )[key] ?? key,
              value,
            ]),
          )}
        />
      ) : (
        <p>
          {result.error.code}: {result.error.message}
        </p>
      )}
    </div>
  );
}
type Query<T> = {
  currentData?: ApiResponse<T>;
  error?: unknown;
  isFetching: boolean;
  isUninitialized: boolean;
  refetch: () => unknown;
};
function Participant<T>({
  name,
  query,
  valid,
  children,
}: {
  name: string;
  query: Query<T>;
  valid: (data: T) => boolean;
  children: (data: T) => ReactNode;
}) {
  const data = query.currentData?.body;
  return (
    <Card className="order-panel" aria-label={name}>
      <div className="order-panel-heading">
        <h2>{name}</h2>
        <Button
          variant="secondary"
          onClick={() => query.refetch()}
          disabled={query.isFetching || query.isUninitialized}
        >
          Refresh {name.toLowerCase()}
        </Button>
      </div>
      {query.isFetching || query.isUninitialized ? (
        <p role="status">Checking {name.toLowerCase()}…</p>
      ) : query.error ? (
        isMissing(query.error, name) ? (
          <p>
            Not started yet. No {name.toLowerCase()} record exists for this
            order.
          </p>
        ) : (
          <p role="alert">{readError(query.error)}</p>
        )
      ) : data && valid(data) ? (
        children(data)
      ) : (
        <p role="alert">
          Unable to verify this record belongs to the order and saga. Retry to
          check again.
        </p>
      )}
    </Card>
  );
}

function Participants({
  orderId,
  sagaId,
}: {
  orderId: string;
  sagaId: string;
}) {
  const payment = useGetPaymentQuery(orderId, manualQueryOptions);
  const reservation = useGetReservationQuery(orderId, manualQueryOptions);
  const shipment = useGetShipmentQuery(orderId, manualQueryOptions);
  const resultMatches = (result: Result | null, operation: string) =>
    !result ||
    (sameId(result.orderId, orderId) &&
      sameId(result.sagaId, sagaId) &&
      result.operation === operation);
  return (
    <div className="participant-grid">
      <Participant
        name="Payment"
        query={payment}
        valid={(data) =>
          matchesRecords([data.payment, data.refund], orderId, sagaId) &&
          resultMatches(data.payment?.chargeResult ?? null, "CHARGE_PAYMENT")
        }
      >
        {(data) => (
          <>
            {data.payment ? (
              <>
                <Fields
                  values={{
                    Status: data.payment.status,
                    Amount: `${data.payment.currency} ${formatMinor(data.payment.amountMinor)}`,
                    "Payment ID": data.payment.id,
                    "Provider transaction": data.payment.providerTransactionId,
                    Updated: data.payment.updatedAt,
                  }}
                />
                <ResultView result={data.payment.chargeResult} />
              </>
            ) : (
              <p>Not started yet. No payment record exists.</p>
            )}
            <h3>Refund</h3>
            {data.refund ? (
              <Fields
                values={{
                  Status: data.refund.status,
                  "Refund ID": data.refund.id,
                  "Provider refund": data.refund.providerRefundId,
                }}
              />
            ) : (
              <p>No refund recorded.</p>
            )}
          </>
        )}
      </Participant>
      <Participant
        name="Reservation"
        query={reservation}
        valid={(data) =>
          matchesRecords([data.reservation], orderId, sagaId) &&
          data.items.every((item) =>
            sameId(item.reservationId, data.reservation.id),
          ) &&
          resultMatches(data.reservation.reserveResult, "RESERVE_INVENTORY")
        }
      >
        {(data) => (
          <>
            <Fields
              values={{
                Status: data.reservation.status,
                "Reservation ID": data.reservation.id,
                "Expires at": data.reservation.expiresAt,
                Updated: data.reservation.updatedAt,
              }}
            />
            <ul className="order-items">
              {data.items.map((item) => (
                <li key={item.productId}>
                  {item.productId} × {item.quantity}
                </li>
              ))}
            </ul>
            <ResultView result={data.reservation.reserveResult} />
          </>
        )}
      </Participant>
      <Participant
        name="Shipment"
        query={shipment}
        valid={(data) =>
          matchesRecords([data.shipment, data.cancellation], orderId, sagaId) &&
          resultMatches(data.shipment?.createResult ?? null, "CREATE_SHIPMENT")
        }
      >
        {(data) => (
          <>
            {data.shipment ? (
              <>
                <Fields
                  values={{
                    Status: data.shipment.status,
                    "Shipment ID": data.shipment.id,
                    "Provider shipment": data.shipment.providerShipmentId,
                    Updated: data.shipment.updatedAt,
                  }}
                />
                <ResultView result={data.shipment.createResult} />
              </>
            ) : (
              <p>Not started yet. No shipment record exists.</p>
            )}
            <h3>Cancellation</h3>
            {data.cancellation ? (
              <Fields
                values={{
                  Status: data.cancellation.status,
                  "Cancellation ID": data.cancellation.id,
                }}
              />
            ) : (
              <p>No cancellation recorded.</p>
            )}
          </>
        )}
      </Participant>
    </div>
  );
}

export function OrderDetails({ orderId }: { orderId: string }) {
  const query = useGetOrderQuery(orderId, manualQueryOptions);
  const data = query.currentData?.body;
  const verified = !!data && matchesOrder(data, orderId);
  const remember = useUiStore((state) => state.addRecentOrder);
  const hydration = useUiStore((state) => state.hydration);
  useEffect(() => {
    if (
      verified &&
      !query.error &&
      !query.isFetching &&
      hydration !== "pending"
    )
      remember(orderId);
  }, [orderId, verified, query.error, query.isFetching, hydration, remember]);
  return (
    <>
      <PageHeading
        eyebrow="ORDER MANAGEMENT"
        title="Order details"
        description="Read-only snapshots from the order and participant services. Automatic polling arrives in Step 9."
        action={
          <ButtonLink variant="secondary" href="/orders">
            Find another order
          </ButtonLink>
        }
      />
      <p className="submission-key">
        Order ID: <code>{orderId}</code>
      </p>
      <SubmissionResult orderId={orderId} />
      <Card className="order-panel" aria-label="Order overview">
        <div className="order-panel-heading">
          <h2>Order overview</h2>
          <Button
            variant="secondary"
            disabled={query.isFetching}
            onClick={() => query.refetch()}
          >
            Refresh order
          </Button>
        </div>
        {query.isFetching ? (
          <p role="status">Checking order…</p>
        ) : query.error ? (
          <p role="alert">
            {isMissing(query.error, "Order")
              ? "Order not found. Check the ID and try again."
              : readError(query.error)}
          </p>
        ) : !verified || !data ? (
          <p role="alert">
            Unable to verify this response belongs to the requested order.
          </p>
        ) : (
          <>
            <StatusBadge
              tone={
                data.saga.status === "COMPLETED"
                  ? "success"
                  : data.saga.status === "FAILED"
                    ? "danger"
                    : "warning"
              }
            >
              {data.saga.status}
            </StatusBadge>
            <Fields
              values={{
                "Customer ID": data.order.customerId,
                Amount: `${data.order.currency} ${formatMinor(data.order.amountMinor)}`,
                "Integer minor units": data.order.amountMinor,
                Created: data.order.createdAt,
                "Saga ID": data.saga.id,
                "Current step": data.saga.currentStep,
                "Current operation": data.saga.currentOperation,
                "Inventory finalized": data.saga.inventoryFinalized
                  ? "Yes"
                  : "No",
                "Compensation required": data.requiresCompensation
                  ? "Yes"
                  : "No",
                "Manual intervention": data.requiresManualIntervention
                  ? "Required"
                  : "Not required",
                "Intervention reason":
                  data.saga.interventionReason ?? "None reported",
                "Saga updated": data.saga.updatedAt,
              }}
            />
            <div className="order-information-grid">
              <div>
                <h3>Items</h3>
                <ul className="order-items">
                  {data.items.map((item) => (
                    <li key={item.productId}>
                      <strong>
                        {demoProducts.find((product) =>
                          sameId(product.id, item.productId),
                        )?.name ?? "Product"}
                      </strong>
                      <br />
                      {item.productId} × {item.quantity}
                    </li>
                  ))}
                </ul>
                <p>
                  Demo names identify seeded products; no catalog price is
                  implied.
                </p>
              </div>
              <div>
                <h3>Shipping address</h3>
                <address>
                  {data.order.shippingAddress.recipient}
                  <br />
                  {data.order.shippingAddress.line1}
                  <br />
                  {data.order.shippingAddress.line2 && (
                    <>
                      {data.order.shippingAddress.line2}
                      <br />
                    </>
                  )}
                  {[
                    data.order.shippingAddress.city,
                    data.order.shippingAddress.region,
                    data.order.shippingAddress.postalCode,
                  ]
                    .filter(Boolean)
                    .join(", ")}
                  <br />
                  {data.order.shippingAddress.countryCode}
                </address>
              </div>
            </div>
          </>
        )}
      </Card>
      {verified && data && !query.error && !query.isFetching && (
        <Participants
          key={data.saga.id}
          orderId={orderId}
          sagaId={data.saga.id}
        />
      )}
    </>
  );
}
