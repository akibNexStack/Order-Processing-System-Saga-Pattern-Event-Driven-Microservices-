import type { Metadata } from "next";
import { CheckoutForm } from "@/components/checkout/checkout-form";

export const metadata: Metadata = { title: "Create Order" };
export default function CreateOrderPage() {
  return <CheckoutForm />;
}
