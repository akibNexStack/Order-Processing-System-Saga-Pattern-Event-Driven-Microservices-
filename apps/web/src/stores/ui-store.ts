import { createStore } from "zustand/vanilla";
import { IdSchema } from "@saga/shared/contracts";

export const UI_STORAGE_KEY = "saga:ui:v1";
export const MAX_RECENT_ORDERS = 20;
export interface UiState {
  menuOpen: boolean;
  hydration: "pending" | "ready" | "unavailable";
  rememberRecentOrders: boolean;
  recentOrderIds: string[];
  setMenuOpen: (open: boolean) => void;
  setRememberRecentOrders: (remember: boolean) => boolean;
  addRecentOrder: (id: string) => boolean;
  removeRecentOrder: (id: string) => boolean;
  clearRecentOrders: () => boolean;
}

export const createUiStore = () =>
  createStore<UiState>()((set, get) => ({
    menuOpen: false,
    hydration: "pending",
    rememberRecentOrders: true,
    recentOrderIds: [],
    setMenuOpen: (menuOpen) => set({ menuOpen }),
    setRememberRecentOrders(rememberRecentOrders) {
      if (get().hydration === "pending") return false;
      set({
        rememberRecentOrders,
        recentOrderIds: rememberRecentOrders ? get().recentOrderIds : [],
      });
      return true;
    },
    addRecentOrder(id) {
      if (
        get().hydration === "pending" ||
        !get().rememberRecentOrders ||
        !IdSchema.safeParse(id).success
      )
        return false;
      const normalized = id.toLowerCase();
      set({
        recentOrderIds: [
          normalized,
          ...get().recentOrderIds.filter((value) => value !== normalized),
        ].slice(0, MAX_RECENT_ORDERS),
      });
      return true;
    },
    removeRecentOrder(id) {
      if (get().hydration === "pending") return false;
      set({
        recentOrderIds: get().recentOrderIds.filter(
          (value) => value !== id.toLowerCase(),
        ),
      });
      return true;
    },
    clearRecentOrders() {
      if (get().hydration === "pending") return false;
      set({ recentOrderIds: [] });
      return true;
    },
  }));
export type UiStore = ReturnType<typeof createUiStore>;
type Storage = Pick<globalThis.Storage, "getItem" | "setItem">;

function readPreferences(raw: string | null) {
  const fallback = {
    rememberRecentOrders: true,
    recentOrderIds: [] as string[],
  };
  if (!raw) return fallback;
  try {
    const parsed = JSON.parse(raw);
    if (
      parsed?.version !== 1 ||
      typeof parsed.state !== "object" ||
      !parsed.state
    )
      return fallback;
    const rememberRecentOrders =
      typeof parsed.state.rememberRecentOrders === "boolean"
        ? parsed.state.rememberRecentOrders
        : true;
    const ids: unknown[] = Array.isArray(parsed.state.recentOrderIds)
      ? parsed.state.recentOrderIds
      : [];
    const recentOrderIds = [
      ...new Set(
        ids
          .filter((id): id is string => IdSchema.safeParse(id).success)
          .map((id) => id.toLowerCase()),
      ),
    ].slice(0, MAX_RECENT_ORDERS);
    return {
      rememberRecentOrders,
      recentOrderIds: rememberRecentOrders ? recentOrderIds : [],
    };
  } catch {
    return fallback;
  }
}

// Explicit post-mount hydration keeps SSR and the first browser render identical.
// Only allowlisted preferences are serialized, never the entire Zustand state.
export function connectUiPersistence(
  store: UiStore,
  getStorage: () => Storage,
) {
  let storage: Storage;
  try {
    storage = getStorage();
    if (store.getState().hydration === "pending") {
      store.setState({
        ...readPreferences(storage.getItem(UI_STORAGE_KEY)),
        hydration: "ready",
      });
    }
  } catch {
    store.setState({ hydration: "unavailable" });
    return () => {};
  }
  let previous = "";
  const persist = () => {
    const { rememberRecentOrders, recentOrderIds } = store.getState();
    const serialized = JSON.stringify({
      version: 1,
      state: {
        rememberRecentOrders,
        recentOrderIds: rememberRecentOrders ? recentOrderIds : [],
      },
    });
    if (serialized === previous) return;
    previous = serialized;
    try {
      storage.setItem(UI_STORAGE_KEY, serialized);
    } catch {
      store.setState({ hydration: "unavailable" });
    }
  };
  persist();
  return store.subscribe(persist);
}
