import type { Metadata } from "next";
import { PageHeading } from "@/components/layout/page-heading";
import { PendingPayments } from "@/components/orders/pending-payments";

export const metadata: Metadata = { title: "Payment approvals" };

export default function PaymentApprovalsPage() {
  return <>
    <PageHeading eyebrow="ADMINISTRATION" title="Payment approvals"
      description="Review bank-transfer orders waiting for payment confirmation." />
    <PendingPayments />
  </>;
}
