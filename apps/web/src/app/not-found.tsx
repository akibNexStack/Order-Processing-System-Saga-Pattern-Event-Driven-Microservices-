import { ButtonLink } from "@/components/ui/button";
import { PageHeading } from "@/components/layout/page-heading";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";

export default function NotFound() {
  return (
    <>
      <PageHeading
        eyebrow="404"
        title="Page not found"
        description="This page does not exist in the workspace."
      />
      <Card>
        <EmptyState
          icon="search"
          title="Let’s get you back on track"
          description="Use the navigation to explore the workspace, or return to the overview."
          action={<ButtonLink href="/">Back to overview</ButtonLink>}
        />
      </Card>
    </>
  );
}
