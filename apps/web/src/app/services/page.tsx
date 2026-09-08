import type { Metadata } from "next";
import { PageHeading } from "@/components/layout/page-heading";
import { PreviewNotice } from "@/components/layout/preview-notice";
import { Card } from "@/components/ui/card";
import { Icon } from "@/components/ui/icon";
import { StatusBadge } from "@/components/ui/status-badge";

export const metadata: Metadata = { title: "Services" };

const services = [
  {
    name: "Order Orchestrator",
    description: "Coordinates the order journey and recovery.",
    checks: "Database · Broker · Recovery",
  },
  {
    name: "Payment",
    description: "Handles charges and refunds.",
    checks: "Database · Broker",
  },
  {
    name: "Inventory",
    description: "Reserves, releases, and finalizes stock.",
    checks: "Database · Broker",
  },
  {
    name: "Shipping",
    description: "Creates and cancels shipments.",
    checks: "Database · Broker",
  },
];

export default function ServicesPage() {
  return (
    <>
      <PageHeading
        eyebrow="OPERATIONS"
        title="Services"
        description="Understand the services and dependencies behind every order."
      />
      <PreviewNotice>
        Live health and readiness checks will be connected in Step 5. These
        cards describe the services, not their current health.
      </PreviewNotice>
      <div className="service-grid">
        {services.map((service) => (
          <Card className="service-card" key={service.name}>
            <div className="service-card-top">
              <span className="area-icon">
                <Icon name="server" />
              </span>
              <StatusBadge>Not checked</StatusBadge>
            </div>
            <h2>{service.name}</h2>
            <p>{service.description}</p>
            <div className="service-checks">
              <span>Readiness checks</span>
              <p>{service.checks}</p>
            </div>
          </Card>
        ))}
      </div>
      <Card className="side-guide">
        <h2>Health and readiness answer different questions</h2>
        <p>
          Health tells you whether a service responds. Readiness checks whether
          its dependencies are available to process work. A responding service
          can still be unready.
        </p>
      </Card>
    </>
  );
}
