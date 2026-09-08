"use client";
import { useCheckoutStore } from "../providers/state-provider";
import { PageHeading } from "../layout/page-heading";
import { Card } from "../ui/card";
import { ButtonLink } from "../ui/button";

export function SubmissionResult({ orderId }: { orderId: string }) {
  const receipt = useCheckoutStore((state) => state.receipt);
  const result = receipt?.orderId === orderId ? receipt : null;
  return (
    <>
      <PageHeading
        eyebrow="ORDER SUBMISSION"
        title="Order submission"
        description="The submission result is a snapshot, not a live status update."
      />
      <Card className="checkout-card submission-receipt">
        <h2>Order ID</h2>
        <p className="submission-key">
          <code>{orderId}</code>
        </p>
        {result ? (
          <p role={result.status === 422 ? "alert" : "status"}>
            {result.message}
          </p>
        ) : (
          <p>
            No submission receipt is available in this tab. This page has not
            checked whether the order exists or its current status.
          </p>
        )}
        <p>
          Full order lookup and details arrive in Step 8; automatic status
          polling arrives in Step 9. Keep the order ID for reference.
        </p>
        <ButtonLink href="/orders/new">Return to checkout</ButtonLink>
      </Card>
    </>
  );
}
