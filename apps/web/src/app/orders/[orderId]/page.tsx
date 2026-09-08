import type { Metadata } from "next";
import { IdSchema } from "@saga/shared/contracts";
import { OrderDetails } from "@/components/orders/order-details";
import { PageHeading } from "@/components/layout/page-heading";
import { ButtonLink } from "@/components/ui/button";

export const metadata: Metadata = { title: "Order details" };
export default async function OrderPage({
  params,
}: {
  params: Promise<{ orderId: string }>;
}) {
  const { orderId } = await params;
  if (!IdSchema.safeParse(orderId).success)
    return (
      <>
        <PageHeading
          eyebrow="ORDER LOOKUP"
          title="Invalid order ID"
          description="Order IDs must be valid UUIDs. No backend request was sent."
        />
        <ButtonLink href="/orders">Find an order</ButtonLink>
      </>
    );
  return (
    <OrderDetails key={orderId.toLowerCase()} orderId={orderId.toLowerCase()} />
  );
}
