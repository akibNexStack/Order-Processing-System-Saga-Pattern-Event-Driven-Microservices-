import type { SagaStep } from '@saga/shared';
import type { sagaInstances } from '../db/schema.js';

const REVERSE_OPERATION = {
  PAYMENT: 'REFUND_PAYMENT', INVENTORY: 'RELEASE_INVENTORY', SHIPPING: 'CANCEL_SHIPMENT',
} as const;

// Preserve the failed forward operation; derive the reverse cursor from the
// separately committed compensation prefix. Finalization is never reversible.
export function nextCompensation(saga: typeof sagaInstances.$inferSelect) {
  const expected: SagaStep[] = saga.currentOperation === 'RESERVE_INVENTORY' ? ['PAYMENT']
    : saga.currentOperation === 'CREATE_SHIPMENT' ? ['PAYMENT', 'INVENTORY'] : [];
  const reverse = [...expected].reverse();
  if (saga.status !== 'COMPENSATING' || saga.inventoryFinalized || !expected.length
    || saga.currentStep !== (expected.length === 1 ? 'INVENTORY' : 'SHIPPING')
    || JSON.stringify(saga.completedSteps) !== JSON.stringify(expected)
    || saga.compensatedSteps.length > reverse.length
    || JSON.stringify(saga.compensatedSteps) !== JSON.stringify(reverse.slice(0, saga.compensatedSteps.length))) {
    throw new Error('Inconsistent compensation progress; reconcile before continuing');
  }
  const step = reverse[saga.compensatedSteps.length];
  return step ? { step, operation: REVERSE_OPERATION[step] } : null;
}
