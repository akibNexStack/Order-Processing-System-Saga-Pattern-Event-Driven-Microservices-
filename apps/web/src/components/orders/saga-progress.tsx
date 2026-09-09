import type { OrderState } from "@/lib/api/contracts";
import { sagaProgress, type ProgressItem } from "@/lib/orders/progress";
import { Card } from "../ui/card";
import { StatusBadge } from "../ui/status-badge";

function Steps({ items }: { items: ProgressItem[] }) {
  return <ol className="saga-steps">
    {items.map(item => <li key={item.operation}>
      <div className="order-panel-heading"><h3>{item.label}</h3>
        <StatusBadge tone={item.status === "Succeeded" ? "success" : item.status === "Failed" ? "danger" :
          item.status === "Running" ? "info" : item.status === "Paused" ? "warning" : "neutral"}>{item.status}</StatusBadge>
      </div>
      <p>{item.note}</p>
    </li>)}
  </ol>;
}
export function SagaProgress({ state }: { state: OrderState }) {
  const { steps, compensation } = sagaProgress(state);
  return <Card className="order-panel" aria-label="Saga progress">
    <h2>Saga progress</h2>
    <p>Progress recorded by the order service. Running includes work queued or awaiting confirmation.</p>
    <Steps items={steps} />
    {compensation.length > 0 && <>
      <h2>Compensation</h2>
      <p>Undoing completed work in reverse order. A successful refund or release does not make the order successful.</p>
      <Steps items={compensation} />
    </>}
  </Card>;
}
