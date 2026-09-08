import type { Metadata } from "next";
import type { ReactNode } from "react";
import { AppShell } from "@/components/layout/app-shell";
import { ApiProvider } from "@/components/providers/api-provider";
import { StateProvider } from "@/components/providers/state-provider";
import { SubmissionGuard } from "@/components/checkout/submission-guard";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Overview | Saga", template: "%s | Saga" },
  description: "Frontend for the Saga order-processing microservices.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <ApiProvider>
          <StateProvider>
            <SubmissionGuard />
            <AppShell>{children}</AppShell>
          </StateProvider>
        </ApiProvider>
      </body>
    </html>
  );
}
