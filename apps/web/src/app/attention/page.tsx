import type { Metadata } from "next";
import { PageHeading } from "@/components/layout/page-heading";
import { PreviewNotice } from "@/components/layout/preview-notice";
import { Card, CardHeading } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { StatusBadge } from "@/components/ui/status-badge";

export const metadata: Metadata = { title: "Attention" };

export default function AttentionPage() {
  return (
    <>
      <PageHeading
        eyebrow="OPERATIONS"
        title="Attention"
        description="A dedicated place for orders that need manual intervention."
      />
      <PreviewNotice>
        The intervention queue is not connected. No conclusion about the health
        of your orders can be drawn from this preview.
      </PreviewNotice>
      <Card>
        <CardHeading
          title="Orders requiring attention"
          description="Intervention reasons and resume actions will be added in Step 11."
          action={<StatusBadge>Not connected</StatusBadge>}
        />
        <EmptyState
          icon="alert"
          title="Intervention queue not connected"
          description="Once connected, this view will show orders that exhausted retries or require investigation, with links to their details and history."
        />
      </Card>
      <div className="explanation-grid">
        <Card className="side-guide">
          <h2>Understand the cause</h2>
          <p>
            Inspect the current operation and history before deciding how to
            continue.
          </p>
        </Card>
        <Card className="side-guide">
          <h2>Resume unfinished work</h2>
          <p>
            After the underlying issue is resolved, a resume action can start
            another attempt. Completed and failed orders remain terminal.
          </p>
        </Card>
      </div>
    </>
  );
}
