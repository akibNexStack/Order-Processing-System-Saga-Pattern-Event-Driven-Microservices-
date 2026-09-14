"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { PageHeading } from "@/components/layout/page-heading";
import { Button, ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

export function AuthCard({ mode }: { mode: "login" | "register" }) {
  const register = mode === "register";
  const router = useRouter();
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError("");
    const form = new FormData(event.currentTarget);
    const response = await fetch(`/api/auth/${register ? "register" : "login"}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: form.get("email"), password: form.get("password") }),
    });
    if (response.ok) {
      window.dispatchEvent(new Event("saga-auth-change"));
      router.push("/");
    }
    else setError((await response.json().catch(() => null))?.error ?? "Unable to continue. Please try again.");
    setPending(false);
  }

  return (
    <>
      <PageHeading
        eyebrow="SECURE ACCESS"
        title={register ? "Create your workspace account" : "Welcome back"}
        description={register ? "Use one account to create orders, follow fulfillment, and manage your profile." : "Sign in to create orders, follow fulfillment, and access controls assigned to your role."}
      />
      <div className="auth-layout">
        <Card className="auth-card">
          <form onSubmit={submit} className="auth-form">
            <div className="auth-form-heading">
              <span className="auth-form-mark">{register ? "01" : "→"}</span>
              <div>
                <h2>{register ? "Account details" : "Sign in"}</h2>
                <p>Use your workspace email and password.</p>
              </div>
            </div>
            <Input label="Email address" name="email" type="email" autoComplete="email" required />
            <Input label="Password" name="password" type="password" autoComplete={register ? "new-password" : "current-password"} minLength={12} hint={register ? "Use at least 12 characters." : undefined} required />
            {error && <p className="field-error auth-error" role="alert">{error}</p>}
            <Button type="submit" disabled={pending}>{pending ? (register ? "Creating account…" : "Signing in…") : (register ? "Create account" : "Sign in")}</Button>
            {!register && <ButtonLink href="/forgot-password" variant="ghost" className="auth-recovery-link">Forgot your password?</ButtonLink>}
            <p className="auth-switch">
              {register ? "Already have an account?" : "New to the workspace?"}{" "}
              <ButtonLink href={register ? "/login" : "/register"} variant="ghost">
                {register ? "Sign in" : "Create an account"}
              </ButtonLink>
            </p>
          </form>
        </Card>
        <aside className="auth-aside" aria-label="Account benefits">
          <p className="eyebrow">ORDER OPERATIONS</p>
          <h2>One account. One clear order trail.</h2>
          <p>Your account links every order you create to a single workspace identity.</p>
          <ul>
            <li>Customer details are applied automatically at checkout.</li>
            <li>Follow each Saga step from payment to delivery.</li>
            <li>Administrative actions remain limited to admins.</li>
          </ul>
        </aside>
      </div>
    </>
  );
}
