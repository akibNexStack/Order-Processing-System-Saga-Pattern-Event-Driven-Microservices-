"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { PageHeading } from "@/components/layout/page-heading";
import { ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

export default function VerifyEmailPage() {
  const token = useSearchParams().get("token") ?? ""; const [message, setMessage] = useState("Verifying your email…"); const [success, setSuccess] = useState(false);
  useEffect(() => { if (!token) { setMessage("This verification link is missing its token."); return; } fetch("/api/auth/verify-email", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token }) }).then(async response => { setSuccess(response.ok); setMessage(response.ok ? "Your email is verified. You can continue to the workspace." : (await response.json().catch(() => ({}))).error ?? "Unable to verify this email."); }); }, [token]);
  return <><PageHeading eyebrow="EMAIL VERIFICATION" title="Confirm your workspace email" description="Verification links are one-time use and expire after 24 hours." /><Card className="account-card"><p role={success ? "status" : "alert"} className={success ? "auth-success" : "field-error"}>{message}</p><ButtonLink href={success ? "/" : "/login"}>{success ? "Open workspace" : "Back to sign in"}</ButtonLink></Card></>;
}
