"use client";

import {
  createContext,
  useContext,
  useEffect,
  useRef,
  type ReactNode,
} from "react";
import { useStore } from "zustand";
import {
  createCheckoutStore,
  type CheckoutState,
} from "../../stores/checkout-store";
import {
  createUiStore,
  connectUiPersistence,
  type UiState,
} from "../../stores/ui-store";

const createStores = () => ({
  checkout: createCheckoutStore(),
  ui: createUiStore(),
});
const StateContext = createContext<ReturnType<typeof createStores> | null>(
  null,
);

export function StateProvider({ children }: { children: ReactNode }) {
  const stores = useRef<ReturnType<typeof createStores> | null>(null);
  if (!stores.current) stores.current = createStores();
  const current = stores.current;
  useEffect(
    () => connectUiPersistence(current.ui, () => window.localStorage),
    [current],
  );
  return (
    <StateContext.Provider value={current}>{children}</StateContext.Provider>
  );
}

function useStores() {
  const stores = useContext(StateContext);
  if (!stores)
    throw new Error("Zustand hooks must be used inside StateProvider");
  return stores;
}
export function useCheckoutStore<T>(selector: (state: CheckoutState) => T) {
  return useStore(useStores().checkout, selector);
}
export function useUiStore<T>(selector: (state: UiState) => T) {
  return useStore(useStores().ui, selector);
}
