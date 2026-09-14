import type { Metadata } from "next";
import { PageHeading } from "@/components/layout/page-heading";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardHeading } from "@/components/ui/card";

export const metadata: Metadata = { title: "Platform Features" };

const sections = [
  { title: "Overview", href: "/", description: "Check service readiness, orders needing attention, and recent order IDs saved in this browser. Recent orders are not a complete server-side order list." },
  { title: "Create Order", href: "/orders/new", description: "Browse product cards, choose quantities, add delivery details, and select Cash on Delivery or Bank Transfer. Prices shown in the browser are recalculated by the backend before the order is saved." },
  { title: "Orders", href: "/orders", description: "Find an order by its UUID. Open its details to inspect saga progress, payment, inventory and shipment states, and event history. Save the order ID to find it again from another browser." },
  { title: "Attention", href: "/attention", description: "Review up to 100 orders requiring intervention. Inspect the error and history, restore the failed dependency, then use Resume when offered. Resume continues recovery; it does not guarantee success or cancel an order." },
  { title: "Services", href: "/services", description: "Inspect the order, payment, inventory, and shipping services. Health means the HTTP process responds; readiness also checks dependencies. Wait until every service is ready before submitting an order." },
  { title: "Account", href: "/account", description: "Register with email and password, sign in, inspect your role, and sign out. Administrators are identified through the configured ADMIN_EMAILS list and can approve bank-transfer orders." },
];

export default function FeaturesPage() {
  return <>
    <PageHeading eyebrow="PLATFORM GUIDE" title="Platform Features"
      description="How catalog pricing, authentication, internal payments, and the Saga workflow cooperate to process an order."
      action={<ButtonLink href="/services">Check services</ButtonLink>} />
    <Card className="order-panel" aria-label="What the platform does">
      <CardHeading title="One order, four cooperating services" />
      <p>This platform processes orders through an event-driven Saga. The Order Orchestrator coordinates independent Payment, Inventory, and Shipping services through RabbitMQ, while each service owns its own PostgreSQL data. The frontend displays persisted backend state rather than treating a submitted request as completed.</p>
      <p>If a later step fails, the backend compensates earlier work where applicable, such as releasing reserved stock and refunding payment. Recovery, retries, and idempotency help handle interruptions and duplicate commands. Follow the final order state and history to confirm the outcome.</p>
      <p><strong>Internal payment workflow:</strong> Cash on Delivery records PAY_ON_DELIVERY and starts fulfilment. Bank Transfer stays PENDING_PAYMENT until an administrator confirms it, then the Saga reserves inventory and creates shipment records. Payment and shipping remain simulated; no real money is charged and no carrier booking is made.</p>
    </Card>
    {sections.map(section => <Card key={section.href} className="order-panel" aria-label={`${section.title} guide`}>
      <CardHeading title={section.title} action={<ButtonLink variant="ghost" href={section.href}>Open {section.title}</ButtonLink>} />
      <p>{section.description}</p>
    </Card>)}
    <Card className="order-panel" aria-label="How to use the platform">
      <CardHeading title="Create and track your first order" />
      <ol className="list-decimal space-y-3 pl-6">
        <li>Create an account or sign in. Configure ADMIN_EMAILS before registration if the account should approve bank transfers.</li>
        <li>Open Services and refresh the checks until order dependencies are ready.</li>
        <li>Open Create Order, select products from the cards, enter delivery information, select a payment method, and submit once. Keep the same submission when retrying an uncertain result.</li>
        <li>Open the resulting order and save its ID. Watch progress and inspect payment, reservation, shipment, and history until the order reaches COMPLETED or fully compensated FAILED.</li>
        <li>For Bank Transfer, an administrator opens the pending order and confirms payment before fulfilment begins.</li>
        <li>If processing needs intervention, inspect Attention and the order history. Restore the dependency before resuming. Do not treat a resume acceptance as proof of completion.</li>
      </ol>
    </Card>
    <Card className="order-panel" aria-label="Capabilities and limits">
      <CardHeading title="Capabilities and current limits" />
      <p>Product cards use the shared server-owned catalog. The backend recalculates totals, while Inventory Service remains responsible for the live stock check during reservation. The Postman collection still exposes direct participant commands for controlled testing; do not issue competing commands against an active order.</p>
      <p>Email/password accounts use a dedicated Auth Service and auth database. Session cookies are HTTP-only. Google sign-in, password reset, email verification, user profile editing, and a full restocking/product-management console are not implemented yet.</p>
      <p>Run the complete local stack with Docker Compose to include Auth Service and auth-db. A sleeping dependency can delay processing; use Services and order history to investigate, then resume eligible work. Production deployment must configure auth database backups, HTTPS, ADMIN_EMAILS, and secrets.</p>
    </Card>
  </>;
}
