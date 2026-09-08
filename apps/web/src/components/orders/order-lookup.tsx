"use client";
import { useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { IdSchema } from "@saga/shared/contracts";
import { useUiStore } from "../providers/state-provider";
import { PageHeading } from "../layout/page-heading";
import { Card, CardHeading } from "../ui/card";
import { Button, ButtonLink } from "../ui/button";
import { Input } from "../ui/input";
import { EmptyState } from "../ui/empty-state";

export function OrderLookup() {
  const router = useRouter();
  const [id, setId] = useState("");
  const [error, setError] = useState("");
  const form = useRef<HTMLFormElement>(null);
  const ids = useUiStore((state) => state.recentOrderIds);
  const hydration = useUiStore((state) => state.hydration);
  const remember = useUiStore((state) => state.rememberRecentOrders);
  const setRemember = useUiStore((state) => state.setRememberRecentOrders);
  const remove = useUiStore((state) => state.removeRecentOrder);
  const clear = useUiStore((state) => state.clearRecentOrders);
  function search(event: FormEvent) {
    event.preventDefault();
    const normalized = id.trim().toLowerCase();
    if (!IdSchema.safeParse(normalized).success) {
      setError("Enter a valid order UUID.");
      form.current?.querySelector("input")?.focus();
      return;
    }
    setError("");
    router.push(`/orders/${normalized}`);
  }
  return (
    <>
      <PageHeading
        eyebrow="ORDER MANAGEMENT"
        title="Orders"
        description="Look up an order and inspect its latest available details."
        action={<ButtonLink href="/orders/new">Create order</ButtonLink>}
      />
      <p className="checkout-notice">
        Order lookup is read-only. Recent orders belong to this browser; this is
        not a list of every order in the system.
      </p>
      <Card>
        <CardHeading
          title="Find an order"
          description="Use the UUID returned after checkout."
        />
        <form
          ref={form}
          className="lookup-preview"
          onSubmit={search}
          noValidate
        >
          <Input
            label="Order ID"
            value={id}
            required
            onChange={(event) => {
              setId(event.target.value);
              setError("");
            }}
            error={error || undefined}
            autoComplete="off"
            placeholder="Enter an order UUID"
          />
          <Button type="submit">Find order</Button>
        </form>
      </Card>
      <Card className="order-panel" aria-labelledby="recent-title">
        <h2 id="recent-title">Recent orders</h2>
        <label className="history-preference">
          <input
            type="checkbox"
            checked={remember}
            disabled={hydration === "pending"}
            onChange={(event) => setRemember(event.target.checked)}
          />
          Remember recent orders in this browser
        </label>
        <p>
          Only order IDs are saved, not customer or delivery details. Turning
          this off clears the saved list.
        </p>
        {hydration === "pending" ? (
          <p role="status">Loading recent orders…</p>
        ) : (
          <>
            {hydration === "unavailable" && (
              <p role="status">
                Browser storage is unavailable. History works in memory only and
                may not survive a reload.
              </p>
            )}
            {!ids.length ? (
              <EmptyState
                icon="orders"
                title={remember ? "No recent orders" : "History is turned off"}
                description="Submit an order or open a valid order to record its ID when history is enabled."
              />
            ) : (
              <>
                <ul className="recent-orders">
                  {ids.map((orderId) => (
                    <li key={orderId}>
                      <ButtonLink variant="ghost" href={`/orders/${orderId}`}>
                        {orderId}
                      </ButtonLink>
                      <Button
                        variant="secondary"
                        aria-label={`Remove ${orderId} from recent orders`}
                        onClick={() => remove(orderId)}
                      >
                        Remove
                      </Button>
                    </li>
                  ))}
                </ul>
                <Button variant="secondary" onClick={clear}>
                  Clear recent orders
                </Button>
              </>
            )}
          </>
        )}
      </Card>
    </>
  );
}
