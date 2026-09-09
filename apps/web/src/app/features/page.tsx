import type { Metadata } from "next";
import { PageHeading } from "@/components/layout/page-heading";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardHeading } from "@/components/ui/card";

export const metadata: Metadata = { title: "Platform Features" };

const sections = [
  { title: "Overview", href: "/", description: "Check service readiness, orders needing attention, and recent order IDs saved in this browser. Recent orders are not a complete server-side order list." },
  { title: "Create Order", href: "/orders/new", description: "Submit a demo checkout with customer, items, amount, currency, and shipping address. The backend coordinates payment, inventory reservation, shipping, and inventory finalization. A submitted or pending order is not yet a completed order." },
  { title: "Orders", href: "/orders", description: "Find an order by its UUID. Open its details to inspect saga progress, payment, inventory and shipment states, and event history. Save the order ID to find it again from another browser." },
  { title: "Attention", href: "/attention", description: "Review up to 100 orders requiring intervention. Inspect the error and history, restore the failed dependency, then use Resume when offered. Resume continues recovery; it does not guarantee success or cancel an order." },
  { title: "Services", href: "/services", description: "Inspect all four services. Health means the HTTP process responds; readiness also checks dependencies. Wait until every service is ready before submitting a demo order." },
];

export default function FeaturesPage() {
  return <>
    <PageHeading eyebrow="PLATFORM GUIDE" title="Platform Features"
      description="What this demo does, how each section works, and how to follow an order from checkout to recovery."
      action={<ButtonLink href="/services">Check services</ButtonLink>} />
    <Card className="order-panel" aria-label="What the platform does">
      <CardHeading title="One order, four cooperating services" />
      <p>This platform demonstrates event-driven order processing using the Saga pattern. The order orchestrator coordinates independent payment, inventory, and shipping services through RabbitMQ. Each service persists its own state. The frontend displays backend responses rather than pretending a request has succeeded.</p>
      <p>If a later step fails, the backend compensates earlier work where applicable, such as releasing reserved stock and refunding payment. Recovery, retries, and idempotency help handle interruptions and duplicate commands. Follow the final order state and history to confirm the outcome.</p>
      <p><strong>Demo only:</strong> payment and shipping are simulated. No real money is charged and no physical shipment is booked. Use fictional customer information.</p>
    </Card>
    {sections.map(section => <Card key={section.href} className="order-panel" aria-label={`${section.title} guide`}>
      <CardHeading title={section.title} action={<ButtonLink variant="ghost" href={section.href}>Open {section.title}</ButtonLink>} />
      <p>{section.description}</p>
    </Card>)}
    <Card className="order-panel" aria-label="How to use the platform">
      <CardHeading title="Your first demo order" />
      <ol className="list-decimal space-y-3 pl-6">
        <li>Open Services and refresh the checks until all four services are ready. Free-hosted services may need time to wake up.</li>
        <li>Open Create Order, use the demo products and fictional details, and submit once. Keep the same submission when retrying an uncertain result to avoid creating another order.</li>
        <li>Open the resulting order and save its ID. Watch progress and inspect payment, reservation, shipment, and history until the order reaches COMPLETED or fully compensated FAILED.</li>
        <li>To demonstrate insufficient stock, submit a separate order for the demo monitor, which starts with zero stock. Inspect its failure and payment compensation.</li>
        <li>If processing needs intervention, inspect Attention and the order history. Restore the dependency before resuming. Do not treat a resume acceptance as proof of completion.</li>
      </ol>
    </Card>
    <Card className="order-panel" aria-label="Capabilities and limits">
      <CardHeading title="API tools and demo limits" />
      <p>The Postman collection exposes direct charge/refund, reserve/release/finalize, and create/cancel shipment commands for controlled API testing. These are not independent manual action buttons in this user interface: normal checkout and compensation are coordinated by the backend. Do not issue competing commands against an active checkout.</p>
      <p>The platform does not provide a full product catalog, restocking screen, user-account management, or arbitrary order cancellation. Completed checkouts consume demo stock; restarting does not replenish it. Provider rejection and timeout scenarios require server configuration changes, not a frontend switch.</p>
      <p>A sleeping or unavailable dependency can delay processing. Check Services and refresh after it recovers. This demo is not an always-on production store. The server-to-server API token is not visitor authentication; private deployment also needs protection for the frontend and its API routes.</p>
    </Card>
  </>;
}
