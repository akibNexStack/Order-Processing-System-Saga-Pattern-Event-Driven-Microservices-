import { configureStore } from "@reduxjs/toolkit";
import { sagaApi } from "./api/api";

export const makeStore = () =>
  configureStore({
    reducer: { [sagaApi.reducerPath]: sagaApi.reducer },
    middleware: (getDefaultMiddleware) =>
      getDefaultMiddleware().concat(sagaApi.middleware),
  });
export type AppStore = ReturnType<typeof makeStore>;
