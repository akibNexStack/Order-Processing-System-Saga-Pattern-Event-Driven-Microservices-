import type { Metadata } from "next";
import { OrderLookup } from "@/components/orders/order-lookup";
export const metadata: Metadata = { title: "Orders" };
export default function OrdersPage() {
  return <OrderLookup />;
}
