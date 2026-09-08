import Link from "next/link";
import { PageHeading } from "@/components/layout/page-heading";
import { PreviewNotice } from "@/components/layout/preview-notice";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardHeading } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Icon, type IconName } from "@/components/ui/icon";
import { StatusBadge } from "@/components/ui/status-badge";

const areas: {
  title: string;
  description: string;
  href: string;
  icon: IconName;
}[] = [
  {
    title: "Orders",
    description: "Find an order and follow its journey.",
    href: "/orders",
    icon: "orders",
  },
  {
    title: "Attention",
    description: "Inspect orders that need a closer look.",
    href: "/attention",
    icon: "alert",
  },
  {
    title: "Services",
    description: "See the dependencies behind every order.",
    href: "/services",
    icon: "server",
  },
];

export default function HomePage() {
  return (
    <>
      <PageHeading
        eyebrow="YOUR WORKSPACE"
        title="Overview"
        description="A clear view of your orders, from checkout to completion."
        action={
          <ButtonLink href="/orders/new">
            <Icon name="plus" />
            Create order
          </ButtonLink>
        }
      />
      <PreviewNotice>
        Checkout can now submit orders to the configured backend. Live health
        checks are available on the Services screen. Open Orders to look up an
        order and its participant records.
      </PreviewNotice>
      <div className="area-grid">
        {areas.map((area) => (
          <Link className="area-card" href={area.href} key={area.href}>
            <span className="area-icon">
              <Icon name={area.icon} />
            </span>
            <h2>{area.title}</h2>
            <p>{area.description}</p>
            <span className="area-link">
              Explore {area.title.toLowerCase()}
              <Icon name="arrow" width="16" height="16" />
            </span>
          </Link>
        ))}
      </div>
      <Card>
        <CardHeading
          title="One order. Four coordinated actions."
          description="The path an order follows through the system."
          action={<StatusBadge>Workflow guide</StatusBadge>}
        />
        <ol className="journey">
          {[
            { title: "Payment", detail: "Confirm the charge" },
            { title: "Inventory", detail: "Reserve the items" },
            { title: "Shipping", detail: "Create the shipment" },
            { title: "Finalize", detail: "Complete the reservation" },
          ].map((step, index) => (
            <li key={step.title}>
              <span className="journey-number">0{index + 1}</span>
              <div>
                <h3>{step.title}</h3>
                <p>{step.detail}</p>
              </div>
            </li>
          ))}
        </ol>
        <p className="journey-note">
          <Icon name="info" width="16" height="16" />
          If a step is rejected, the system coordinates the required refunds and
          stock releases.
        </p>
      </Card>
      <div className="overview-bottom">
        <Card>
          <CardHeading
            title="Recent orders"
            description="Your recently opened orders will appear here."
          />
          <EmptyState
            icon="orders"
            title="Your next order starts here"
            description="Order creation and lookup are coming next. Explore the workspace while those connections are being built."
            action={
              <ButtonLink href="/orders" variant="secondary">
                Open orders
                <Icon name="arrow" width="16" height="16" />
              </ButtonLink>
            }
          />
        </Card>
        <Card className="workspace-guide">
          <span className="area-icon">
            <Icon name="box" />
          </span>
          <h2>Built around the order journey</h2>
          <p>
            Follow progress, understand what happened, and find the next action
            in one workspace.
          </p>
          <div className="guide-item">
            <Icon name="orders" />
            <span>Order details and event history</span>
          </div>
          <div className="guide-item">
            <Icon name="alert" />
            <span>Recovery and intervention</span>
          </div>
          <div className="guide-item">
            <Icon name="server" />
            <span>Service health and readiness</span>
          </div>
          <StatusBadge tone="info">Service checks connected</StatusBadge>
        </Card>
      </div>
    </>
  );
}
