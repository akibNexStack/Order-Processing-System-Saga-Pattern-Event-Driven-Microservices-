"use client";

import { useState, type FormEvent } from "react";
import { PageHeading } from "@/components/layout/page-heading";
import { Button, ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

export default function ForgotPasswordPage() {
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError("");
    const form = new FormData(event.currentTarget);
    const response = await fetch("/api/auth/password-reset/request", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: form.get("email") }) });
    const body = await response.json().catch(() => ({}));
    if (response.ok) setMessage("If that account exists, a password-reset link has been sent."); else setError(body.error ?? "Unable to request a password reset.");
  }
  return <><PageHeading eyebrow="ACCOUNT RECOVERY" title="Reset your password" description="Enter your workspace email to request a one-time reset link." /><div className="auth-layout"><Card className="auth-card"><form className="auth-form" onSubmit={submit}><div className="auth-form-heading"><span className="auth-form-mark">?</span><div><h2>Request reset</h2><p>For security, this response is the same for every email address.</p></div></div><Input label="Email address" name="email" type="email" autoComplete="email" required />{message && <p role="status" className="auth-success">{message}</p>}{error && <p role="alert" className="field-error auth-error">{error}</p>}<Button type="submit">Send reset link</Button><p className="auth-switch"><ButtonLink href="/login" variant="ghost">Back to sign in</ButtonLink></p></form></Card><aside className="auth-aside"><p className="eyebrow">SECURE RECOVERY</p><h2>One-time and time-limited.</h2><p>A reset link expires after one hour. Changing your password revokes existing sessions.</p></aside></div></>;
}
