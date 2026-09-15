"use client";

import { useSessionUser } from "@/lib/auth/session";
import { PendingPayments } from "./pending-payments";
import { Card } from "../ui/card";

export function PaymentApprovals() {
  const user = useSessionUser();
  if (user === undefined) return <Card><p role="status">Checking administrator access…</p></Card>;
  if (user?.role !== "ADMIN") return <Card><p role="alert">Administrator access is required to review payment approvals.</p></Card>;
  return <PendingPayments />;
}
