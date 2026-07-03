import { NextResponse } from "next/server";
import { telemetryEventSchema } from "@free-ai-open/telemetry";
import { redactTelemetryPayload } from "@free-ai-open/privacy-redactor";

export async function POST(request: Request) {
  const raw = await request.json().catch(() => null);
  if (!raw) {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const redacted = redactTelemetryPayload(raw);
  const parsed = telemetryEventSchema.safeParse(redacted);

  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid telemetry payload" }, { status: 400 });
  }

  // TODO: Persist parsed.data to Supabase through packages/server-data.
  // Do not store raw payload.

  return NextResponse.json({ ok: true });
}
