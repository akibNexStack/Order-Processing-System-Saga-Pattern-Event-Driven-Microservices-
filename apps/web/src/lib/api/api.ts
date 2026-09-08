import { createApi } from "@reduxjs/toolkit/query/react";
import type { z } from "zod";
import {
  ResultSchema,
  type CreateOrderRequest,
  type CommandFor,
  type Result,
} from "@saga/shared/contracts";
import * as c from "./contracts";
import { createBaseQuery, type ApiResponse } from "./base-query";

type Reply<S extends z.ZodType> = ApiResponse<z.infer<S>>;
const idPath = (prefix: string, id: string) =>
  `${prefix}/${encodeURIComponent(id)}`;
const command = (url: string, body: { operation: string }) => ({
  url,
  method: "POST" as const,
  body,
  schema: ResultSchema.refine((result) => result.operation === body.operation),
  statuses: [200, 202, 409, 422],
});

// One cache per provider, no persisted server state and no automatic mutation retries.
export const sagaApi = createApi({
  reducerPath: "sagaApi",
  baseQuery: createBaseQuery(),
  tagTypes: ["Order", "Attention", "Payment", "Inventory", "Shipment"],
  keepUnusedDataFor: 30,
  refetchOnMountOrArgChange: true,
  refetchOnFocus: true,
  refetchOnReconnect: true,
  endpoints: (build) => ({
    createOrder: build.mutation<
      Reply<typeof c.OrderStateSchema>,
      CreateOrderRequest
    >({
      query: (body) => ({
        url: "orders",
        method: "POST",
        body,
        schema: c.OrderStateSchema,
        statuses: [200, 201, 202, 422],
      }),
      invalidatesTags: ["Order", "Attention"],
    }),
    getOrder: build.query<Reply<typeof c.OrderStateSchema>, string>({
      query: (id) => ({
        url: idPath("orders", id),
        schema: c.OrderStateSchema,
      }),
      providesTags: (_r, _e, id) => [{ type: "Order", id }],
    }),
    getOrderHistory: build.query<Reply<typeof c.HistorySchema>, string>({
      query: (id) => ({
        url: `${idPath("orders", id)}/history`,
        schema: c.HistorySchema,
      }),
      providesTags: (_r, _e, id) => [{ type: "Order", id }],
    }),
    getAttention: build.query<Reply<typeof c.AttentionSchema>, void>({
      query: () => ({ url: "orders/attention", schema: c.AttentionSchema }),
      providesTags: ["Attention"],
    }),
    resumeOrder: build.mutation<Reply<typeof c.OrderStateSchema>, string>({
      query: (id) => ({
        url: `${idPath("orders", id)}/resume`,
        method: "POST",
        schema: c.OrderStateSchema,
        statuses: [200, 202, 422],
      }),
      invalidatesTags: (_r, _e, id) => [{ type: "Order", id }, "Attention"],
    }),
    getPayment: build.query<Reply<typeof c.PaymentStateSchema>, string>({
      query: (id) => ({
        url: idPath("payments", id),
        schema: c.PaymentStateSchema,
      }),
      providesTags: ["Payment"],
    }),
    chargePayment: build.mutation<
      ApiResponse<Result>,
      CommandFor<"CHARGE_PAYMENT">
    >({
      query: (body) => command("payments/charge", body),
      invalidatesTags: ["Payment"],
    }),
    refundPayment: build.mutation<
      ApiResponse<Result>,
      CommandFor<"REFUND_PAYMENT">
    >({
      query: (body) => command("payments/refund", body),
      invalidatesTags: ["Payment"],
    }),
    getReservation: build.query<Reply<typeof c.ReservationStateSchema>, string>(
      {
        query: (id) => ({
          url: idPath("inventory/reservations", id),
          schema: c.ReservationStateSchema,
        }),
        providesTags: ["Inventory"],
      },
    ),
    reserveInventory: build.mutation<
      ApiResponse<Result>,
      CommandFor<"RESERVE_INVENTORY">
    >({
      query: (body) => command("inventory/reserve", body),
      invalidatesTags: ["Inventory"],
    }),
    releaseInventory: build.mutation<
      ApiResponse<Result>,
      CommandFor<"RELEASE_INVENTORY">
    >({
      query: (body) => command("inventory/release", body),
      invalidatesTags: ["Inventory"],
    }),
    finalizeInventory: build.mutation<
      ApiResponse<Result>,
      CommandFor<"FINALIZE_INVENTORY">
    >({
      query: (body) => command("inventory/finalize", body),
      invalidatesTags: ["Inventory"],
    }),
    getShipment: build.query<Reply<typeof c.ShipmentStateSchema>, string>({
      query: (id) => ({
        url: idPath("shipments", id),
        schema: c.ShipmentStateSchema,
      }),
      providesTags: ["Shipment"],
    }),
    createShipment: build.mutation<
      ApiResponse<Result>,
      CommandFor<"CREATE_SHIPMENT">
    >({
      query: (body) => command("shipments/create", body),
      invalidatesTags: ["Shipment"],
    }),
    cancelShipment: build.mutation<
      ApiResponse<Result>,
      CommandFor<"CANCEL_SHIPMENT">
    >({
      query: (body) => command("shipments/cancel", body),
      invalidatesTags: ["Shipment"],
    }),
    getServiceHealth: build.query<Reply<typeof c.HealthSchema>, c.ServiceName>({
      query: (service) => ({
        url: `services/${service}/health`,
        schema: c.HealthSchema,
      }),
    }),
    getServiceReadiness: build.query<
      Reply<typeof c.ReadinessSchema>,
      c.ServiceName
    >({
      query: (service) => ({
        url: `services/${service}/ready`,
        schema: c.ReadinessSchema,
        statuses: [200, 503],
      }),
    }),
  }),
});

export const {
  useCreateOrderMutation,
  useGetOrderQuery,
  useGetOrderHistoryQuery,
  useGetAttentionQuery,
  useResumeOrderMutation,
  useGetPaymentQuery,
  useChargePaymentMutation,
  useRefundPaymentMutation,
  useGetReservationQuery,
  useReserveInventoryMutation,
  useReleaseInventoryMutation,
  useFinalizeInventoryMutation,
  useGetShipmentQuery,
  useCreateShipmentMutation,
  useCancelShipmentMutation,
  useGetServiceHealthQuery,
  useGetServiceReadinessQuery,
} = sagaApi;
