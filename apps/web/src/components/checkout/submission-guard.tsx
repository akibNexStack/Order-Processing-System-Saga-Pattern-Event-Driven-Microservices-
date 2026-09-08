"use client";
import { useEffect } from "react";
import { useCheckoutStore } from "../providers/state-provider";

// Root-mounted so client navigation does not remove the reload warning.
export function SubmissionGuard() {
  const phase = useCheckoutStore((state) => state.submission);
  useEffect(() => {
    if (phase !== "submitting" && phase !== "uncertain") return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [phase]);
  return null;
}
