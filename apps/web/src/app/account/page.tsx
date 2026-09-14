"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { PageHeading } from "@/components/layout/page-heading";
import { Button, ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";

type User = { id: string; email: string; role: "ADMIN" | "CUSTOMER" };

export default function AccountPage() {
  const [user, setUser] = useState<User | null | undefined>(undefined);
  const router = useRouter();
  useEffect(() => { fetch("/api/auth/session").then((r) => r.ok ? r.json() : null).then((value) => setUser(value?.user ?? null)); }, []);
  return <>
    <PageHeading eyebrow="ACCOUNT" title="Your workspace profile" description="Your account is used as the customer identity for new orders." />
    {user === undefined ? <Card className="account-card"><p className="field-hint">Loading your account…</p></Card> : !user ? <Card><EmptyState title="You are not signed in" description="Sign in to create orders connected to your workspace account." action={<ButtonLink href="/login">Sign in</ButtonLink>} /></Card> : <Card className="account-card">
      <div className="account-identity"><span className="account-avatar">{user.email.slice(0, 1).toUpperCase()}</span><div><p className="eyebrow">SIGNED-IN ACCOUNT</p><h2>{user.email}</h2><span className={`role-badge role-badge--${user.role.toLowerCase()}`}>{user.role === "ADMIN" ? "Administrator" : "Customer"}</span></div></div>
      <dl className="account-details"><div><dt>Order identity</dt><dd>Applied automatically when you create an order</dd></div><div><dt>Permissions</dt><dd>{user.role === "ADMIN" ? "Can confirm bank-transfer payments" : "Can create and follow your orders"}</dd></div></dl>
      <div className="account-actions"><ButtonLink href="/orders/new">Create an order</ButtonLink><Button variant="secondary" onClick={async () => { await fetch("/api/auth/session", { method: "DELETE" }); window.dispatchEvent(new Event("saga-auth-change")); router.push("/login"); }}>Sign out</Button></div>
    </Card>}
  </>;
}
