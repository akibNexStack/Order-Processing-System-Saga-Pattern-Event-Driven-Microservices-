import { fetchBaseQuery, type BaseQueryFn } from "@reduxjs/toolkit/query";
import type { ZodType } from "zod";

export type ApiResponse<T> = {
  body: T;
  status: number;
  retryAfter: string | null;
  location: string | null;
};
export type ApiError = {
  status: number | string;
  httpStatus?: number;
  location?: string | null;
  body?: unknown;
  message: string;
  retryAfter?: string | null;
};
export type ApiRequest = {
  url: string;
  method?: "GET" | "POST";
  body?: unknown;
  schema: ZodType;
  statuses?: number[];
};

export function createBaseQuery(
  baseUrl = "/api/",
  timeout = 15000,
): BaseQueryFn<ApiRequest, unknown, ApiError> {
  const request = fetchBaseQuery({
    baseUrl,
    timeout,
    cache: "no-store",
    headers: { Accept: "application/json" },
  });
  return async ({ schema, statuses = [200], ...args }, api, extra) => {
    const result = await request(
      {
        ...args,
        validateStatus: (response) => statuses.includes(response.status),
        responseHandler: async (response) => {
          if (
            !/^application\/(?:[\w.+-]+\+)?json(?:\s*;|$)/i.test(
              response.headers.get("content-type") ?? "",
            )
          )
            throw new Error("Expected JSON response");
          return response.json();
        },
      },
      api,
      extra,
    );
    const response = result.meta?.response;
    const retryAfter = response?.headers.get("Retry-After") ?? null;
    if (result.error)
      return {
        error: {
          status: result.error.status,
          httpStatus: response?.status,
          location: response?.headers.get("Location") ?? null,
          body: result.error.data,
          message:
            "error" in result.error
              ? result.error.error
              : `Request failed (${result.error.status})`,
          retryAfter,
        },
      };
    const parsed = schema.safeParse(result.data);
    if (!parsed.success)
      return {
        error: {
          status:
            response && !response.ok ? response.status : "INVALID_RESPONSE",
          httpStatus: response?.status,
          location: response?.headers.get("Location") ?? null,
          body: result.data,
          message:
            response && !response.ok
              ? `Request failed (${response.status})`
              : "Backend response does not match the API contract",
          retryAfter,
        },
      };
    return {
      data: {
        body: parsed.data,
        status: response!.status,
        retryAfter,
        location: response!.headers.get("Location") ?? null,
      },
    };
  };
}
