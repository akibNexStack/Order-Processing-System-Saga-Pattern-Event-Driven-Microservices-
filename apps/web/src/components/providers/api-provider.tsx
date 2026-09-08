"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { Provider } from "react-redux";
import { setupListeners } from "@reduxjs/toolkit/query";
import { makeStore, type AppStore } from "@/lib/store";

export function ApiProvider({ children }: { children: ReactNode }) {
  const store = useRef<AppStore | null>(null);
  if (!store.current) store.current = makeStore();
  const current = store.current;
  useEffect(() => setupListeners(current.dispatch), [current]);
  return <Provider store={current}>{children}</Provider>;
}
