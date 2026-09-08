import type { Metadata } from "next";
import { ServiceStatusScreen } from "@/components/services/service-status";

export const metadata: Metadata = { title: "Services" };

export default function ServicesPage() {
  return <ServiceStatusScreen />;
}
