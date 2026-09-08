import type { Metadata } from "next";
import { PageHeading } from "@/components/layout/page-heading";
import { PreviewNotice } from "@/components/layout/preview-notice";
import { Card, CardHeading } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StatusBadge } from "@/components/ui/status-badge";

export const metadata: Metadata = { title: "Create Order" };

export default function CreateOrderPage() {
  return (
    <>
      <PageHeading
        eyebrow="CHECKOUT"
        title="Create order"
        description="Start an order with the items and delivery details it needs."
      />
      <PreviewNotice>
        Checkout is not connected yet. These fields are a layout preview; you
        cannot submit an order at this stage.
      </PreviewNotice>
      <div className="content-columns">
        <Card>
          <CardHeading
            title="Order details"
            description="The checkout form will be implemented in Step 6."
            action={<StatusBadge>Preview</StatusBadge>}
          />
          <fieldset disabled className="preview-fields">
            <legend className="sr-only">Order details preview</legend>
            <Input
              label="Customer ID"
              placeholder="Customer UUID"
              hint="The customer placing this order."
            />
            <Input label="Items" placeholder="Product selection coming soon" />
            <div className="field-grid">
              <Input label="Amount" placeholder="0.00" inputMode="decimal" />
              <Input label="Currency" placeholder="BDT or USD" />
            </div>
            <Input
              label="Shipping address"
              placeholder="Delivery details coming soon"
            />
            <Button disabled>Create order</Button>
          </fieldset>
        </Card>
        <Card className="side-guide">
          <h2>Before you submit</h2>
          <ol className="checklist">
            <li>Choose products and quantities.</li>
            <li>Review the amount and currency.</li>
            <li>Add the delivery address.</li>
            <li>Submit once, then follow the order’s progress.</li>
          </ol>
          <p>
            The same checkout key will be reused if a request needs to be
            retried.
          </p>
        </Card>
      </div>
    </>
  );
}
