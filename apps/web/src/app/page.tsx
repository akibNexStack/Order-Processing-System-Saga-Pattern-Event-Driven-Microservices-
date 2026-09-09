import { PageHeading } from "@/components/layout/page-heading";
import { ButtonLink } from "@/components/ui/button";
import { Overview } from "@/components/orders/overview";

export default function HomePage() {
  return <>
    <PageHeading eyebrow="YOUR WORKSPACE" title="Overview"
      description="Readiness, orders needing attention, and your recent orders."
      action={<ButtonLink href="/orders/new">Create order</ButtonLink>} />
    <Overview />
  </>;
}
