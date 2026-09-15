import type { OrderItems } from './contracts.js';

// The order service is the authority for these prices.  The browser may display
// them, but its submitted amount is always recalculated before persistence.
export const catalog = [
  { id: '44444444-4444-4444-8444-444444444444', sku: 'KEYBOARD-01', name: 'Mechanical Keyboard', priceMinor: 250000 },
  { id: '55555555-5555-4555-8555-555555555555', sku: 'MOUSE-01', name: 'Wireless Mouse', priceMinor: 85000 },
  { id: '66666666-6666-4666-8666-666666666666', sku: 'MONITOR-01', name: '27-inch Monitor', priceMinor: 3200000 },
] as const;

const prices = new Map<string, number>(catalog.map(product => [product.id, product.priceMinor]));
export function calculateOrderTotal(items: OrderItems): number {
  let total = 0;
  for (const item of items) {
    const price = prices.get(item.productId.toLowerCase());
    if (!price) throw new Error('Unknown or unavailable product');
    total += price * item.quantity;
  }
  if (!Number.isSafeInteger(total) || total < 1 || total > 9_999_999_999) throw new Error('Order total is out of range');
  return total;
}
