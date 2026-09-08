"use client";
import { useCheckoutStore } from "../providers/state-provider";
import { Card } from "../ui/card";
import { ButtonLink } from "../ui/button";

export function SubmissionResult({ orderId }: { orderId: string }) {
  const receipt = useCheckoutStore((state) => state.receipt);
  if (receipt?.orderId !== orderId) return null;
  return (
    <Card
      className="checkout-card submission-receipt"
      aria-label="Submission receipt"
    >
      <h2>Submission receipt</h2>
      <p className="submission-key">
        <code>{orderId}</code>
      </p>
      <p role={receipt.status === 422 ? "alert" : "status"}>
        {receipt.message}
      </p>
      <p>
        This is the original submission response, not the current order status.
        Updated details are shown separately below.
      </p>
      <ButtonLink href="/orders/new">Return to checkout</ButtonLink>
    </Card>
  );
}
