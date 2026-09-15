import { NextResponse } from "next/server";
import { authHeaders } from "../../../../lib/server/auth";

export async function POST(request: Request) {
  try {
    const upstream = await fetch(`${process.env.AUTH_SERVICE_URL ?? "http://127.0.0.1:3005"}/auth/verify-email`, { method: "POST", headers: authHeaders(request), body: await request.text(), cache: "no-store" });
    return NextResponse.json(await upstream.json(), { status: upstream.status });
  } catch { return NextResponse.json({ error: "Authentication service is unavailable" }, { status: 503 }); }
}
