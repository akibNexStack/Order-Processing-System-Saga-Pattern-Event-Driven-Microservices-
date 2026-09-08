import "server-only";
import { parseBackendConfig } from "./config";
import { proxyError, proxyRequest } from "./proxy";

export function forwardToBackend(request: Request, segments: string[]) {
  try {
    return proxyRequest(request, segments, parseBackendConfig(process.env));
  } catch {
    // Never send origins, credentials, raw connection errors, or env values to browsers.
    return proxyError(
      500,
      "BACKEND_CONFIGURATION_ERROR",
      "Backend connection is not configured correctly",
    );
  }
}
