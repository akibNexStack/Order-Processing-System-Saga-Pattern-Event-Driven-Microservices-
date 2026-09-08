import { forwardToBackend } from "@/lib/server/backend";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handle(
  request: Request,
  context: { params: Promise<{ path: string[] }> },
) {
  const { path } = await context.params;
  return forwardToBackend(request, path);
}

export {
  handle as GET,
  handle as POST,
  handle as PUT,
  handle as PATCH,
  handle as DELETE,
  handle as OPTIONS,
};

// Avoid Next.js implicitly treating a HEAD request as a GET with a JSON body.
export async function HEAD(
  request: Request,
  context: { params: Promise<{ path: string[] }> },
) {
  const response = await handle(request, context);
  return new Response(null, {
    status: response.status,
    headers: response.headers,
  });
}
