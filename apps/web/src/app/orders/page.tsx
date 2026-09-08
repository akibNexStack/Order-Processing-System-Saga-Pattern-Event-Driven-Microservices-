import type { Metadata } from "next";
import { PageHeading } from "@/components/layout/page-heading";
import { PreviewNotice } from "@/components/layout/preview-notice";
import { Button, ButtonLink } from "@/components/ui/button";
import { Card, CardHeading } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Icon } from "@/components/ui/icon";

export const metadata: Metadata = { title: "Orders" };

export default function OrdersPage() {
  return (
    <>
      <PageHeading
        eyebrow="ORDER MANAGEMENT"
        title="Orders"
        description="Find an order, inspect its details, and follow its progress."
        action={
          <ButtonLink href="/orders/new">
            <Icon name="plus" />
            Create order
          </ButtonLink>
        }
      />
      <PreviewNotice>
        Order lookup and recent orders will be connected in Step 8. This is not
        a list of all orders in the system.
      </PreviewNotice>
      <Card>
        <CardHeading
          title="Find an order"
          description="Use the order ID returned after checkout."
        />
        <div className="lookup-preview">
          <Input
            label="Order ID"
            placeholder="Enter an order UUID"
            disabled
            hint="Search will be available when the order API is connected."
          />
          <Button disabled>
            <Icon name="search" />
            Find order
          </Button>
        </div>
      </Card>
      <Card>
        <CardHeading
          title="Recently opened"
          description="This browser’s recent orders will appear here."
        />
        <EmptyState
          icon="orders"
          title="Order lookup is coming next"
          description="Once connected, you’ll be able to open an order by ID and see its payment, reservation, shipment, and history."
        />
      </Card>
    </>
  );
}
