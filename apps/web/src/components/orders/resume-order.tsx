"use client";
import { useRef } from "react";
import { useResumeOrderMutation } from "@/lib/api/api";
import type { OrderState } from "@/lib/api/contracts";
import { resumeMessage } from "@/lib/orders/resume";
import { Button } from "../ui/button";
import { Card } from "../ui/card";

export function ResumeOrder({ state, checking }: { state: OrderState; checking: boolean }) {
  const orderId = state.order.id.toLowerCase();
  const [resume, result] = useResumeOrderMutation({ fixedCacheKey: `resume:${orderId}` });
  const lock = useRef(false);
  const terminal = ["COMPLETED", "FAILED"].includes(state.saga.status);
  async function submit() {
    if (lock.current || result.isLoading || checking || terminal) return;
    lock.current = true;
    try { await resume(orderId).unwrap(); }
    catch { /* Render the shared mutation error; never retry automatically. */ }
    finally { lock.current = false; }
  }
  if (terminal && !result.data && !result.error && !result.isLoading) return null;
  return <Card className="order-panel" aria-label="Order recovery">
    <h2>Order recovery</h2>
    {!terminal && <>
      <p>After resolving the underlying issue, resume unfinished work. An outstanding command will not be duplicated by the order service.</p>
      <Button disabled={checking || result.isLoading} onClick={submit}>
        {result.isLoading ? "Resuming order…" : "Resume order"}
      </Button>
    </>}
    {result.isLoading && <p role="status">The resume request is in progress. Wait for the outcome before submitting another request.</p>}
    {result.error && <p role="alert">The resume outcome could not be confirmed. Refresh the order and review its current state before trying again. No automatic retry was sent.</p>}
    {result.data && !result.isLoading && !result.error && <p role="status">{resumeMessage(result.data)}</p>}
  </Card>;
}
