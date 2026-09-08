import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { IdSchema } from "@saga/shared/contracts";
import { SubmissionResult } from "@/components/checkout/submission-result";

export const metadata: Metadata = { title: "Order submission" };
export default async function OrderPage({
  params,
}: {
  params: Promise<{ orderId: string }>;
}) {
  const { orderId } = await params;
  if (!IdSchema.safeParse(orderId).success) notFound();
  return <SubmissionResult orderId={orderId.toLowerCase()} />;
}
