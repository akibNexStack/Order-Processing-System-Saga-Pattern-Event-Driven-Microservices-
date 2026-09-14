import type { SagaStep } from '@saga/shared';
import type { sagaInstances } from '../db/schema.js';

// The REVERSE_OPERATION constant defines the mapping of forward operations to their corresponding reverse operations for compensation. This is used to determine the next compensation step based on the current state of the saga.
const REVERSE_OPERATION = {
  PAYMENT: 'REFUND_PAYMENT',
  INVENTORY: 'RELEASE_INVENTORY',
  SHIPPING: 'CANCEL_SHIPMENT',
} as const;

// Preserve the failed forward operation; derive the reverse cursor from the
// separately committed compensation prefix. Finalization is never reversible.
export function nextCompensation(saga: typeof sagaInstances.$inferSelect) {
  const expected: SagaStep[] =
    saga.currentOperation === 'RESERVE_INVENTORY'
      ? ['PAYMENT']
      : saga.currentOperation === 'CREATE_SHIPMENT'
        ? ['PAYMENT', 'INVENTORY']
        : [];
  const reverse = [...expected].reverse();

  // The nextCompensation function determines the next compensation step for a given saga instance. It checks the current state of the saga, including its status, completed steps, and compensated steps, to ensure that the compensation process is consistent. If the saga is eligible for compensation, it returns the next step and its corresponding reverse operation; otherwise, it throws an error indicating that manual reconciliation is required.
  if (
    saga.status !== 'COMPENSATING' ||
    saga.inventoryFinalized ||
    !expected.length ||
    saga.currentStep !== (expected.length === 1 ? 'INVENTORY' : 'SHIPPING') ||
    JSON.stringify(saga.completedSteps) !== JSON.stringify(expected) ||
    saga.compensatedSteps.length > reverse.length ||
    JSON.stringify(saga.compensatedSteps) !==
      JSON.stringify(reverse.slice(0, saga.compensatedSteps.length))
  ) {
    throw new Error('Inconsistent compensation progress; reconcile before continuing');
  }
  const step = reverse[saga.compensatedSteps.length];
  return step ? { step, operation: REVERSE_OPERATION[step] } : null;
}
