import type { ApiResponse } from "../api/base-query";
import type { OrderState } from "../api/contracts";
import { matchesOrder } from "./view";

export function validResumeReply(reply: ApiResponse<OrderState>, id: string) {
  if (!matchesOrder(reply.body, id)) return false;
  const status = reply.body.saga.status;
  return reply.status === 200 ? status === "COMPLETED" :
    reply.status === 422 ? status === "FAILED" :
    reply.status === 202 && (status === "IN_PROGRESS" || status === "COMPENSATING");
}

export function resumeMessage(reply: ApiResponse<OrderState>) {
  if (reply.status === 200) return "The resume response confirmed the order is completed.";
  if (reply.status === 422) return "The resume response confirmed the order is failed. It cannot be restarted.";
  return reply.body.requiresManualIntervention
    ? "The resume request returned, but manual intervention is still required. Review the reason before trying again."
    : "Resume accepted. Processing is still active; automatic status updates will continue.";
}
