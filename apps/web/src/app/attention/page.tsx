import type { Metadata } from "next";
import { PageHeading } from "@/components/layout/page-heading";
import { AttentionList } from "@/components/orders/attention-list";

export const metadata: Metadata = { title: "Attention" };
export default function AttentionPage() {
  return <>
    <PageHeading eyebrow="OPERATIONS" title="Attention"
      description="Inspect intervention reasons, open an order and its history, and resume unfinished work after resolving the issue." />
    <AttentionList />
  </>;
}
