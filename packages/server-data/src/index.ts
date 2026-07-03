// Wrap Supabase access here later.
// Do not import Supabase directly throughout the app.

export interface PersistTelemetryResult {
  ok: boolean;
}

export async function persistTelemetryEvent(): Promise<PersistTelemetryResult> {
  // TODO: implement Supabase insert after schema is created.
  return { ok: true };
}
