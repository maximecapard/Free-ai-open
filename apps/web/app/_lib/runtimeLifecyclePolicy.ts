export type RuntimeDisposalTrigger =
  | "app_root_unmount"
  | "explicit_reload"
  | "performance_replacement"
  | "recovery"
  | "model_replacement"
  | "route_view_unmount"
  | "visibility_hidden";

const DISPOSING_TRIGGERS = new Set<RuntimeDisposalTrigger>([
  "app_root_unmount",
  "explicit_reload",
  "performance_replacement",
  "recovery",
  "model_replacement",
]);

export function shouldDisposeRuntimeForTrigger(trigger: RuntimeDisposalTrigger): boolean {
  return DISPOSING_TRIGGERS.has(trigger);
}
