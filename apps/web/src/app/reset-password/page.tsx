"use client";

import { useSearchParams, useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { PageHeading } from "@/components/layout/page-heading";
import { Button, ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

export default function ResetPasswordPage() {
  const params = useSearchParams(); const router = useRouter(); const [error, setError] = useState(""); const token = params.get("token") ?? "";
  async function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); setError(""); const form = new FormData(event.currentTarget); const response = await fetch("/api/auth/password-reset/confirm", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token, password: form.get("password") }) }); if (response.ok) router.push("/login"); else setError((await response.json().catch(() => ({}))).error ?? "Unable to reset password."); }
  return <><PageHeading eyebrow="ACCOUNT RECOVERY" title="Choose a new password" description="Your existing sessions will be signed out after the password changes." /><div className="auth-layout"><Card className="auth-card"><form className="auth-form" onSubmit={submit}><div className="auth-form-heading"><span className="auth-form-mark">→</span><div><h2>New password</h2><p>Use at least 12 characters.</p></div></div><Input label="New password" name="password" type="password" autoComplete="new-password" minLength={12} required />{error && <p role="alert" className="field-error auth-error">{error}</p>}<Button type="submit" disabled={!token}>Update password</Button>{!token && <p className="field-error">This reset link is missing its token.</p>}<p className="auth-switch"><ButtonLink href="/forgot-password" variant="ghost">Request a new link</ButtonLink></p></form></Card><aside className="auth-aside"><p className="eyebrow">SECURE RECOVERY</p><h2>Start fresh, safely.</h2><p>Reset links are one-time use and expire after one hour.</p></aside></div></>;
}
