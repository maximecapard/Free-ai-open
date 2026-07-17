export type RuntimeDisposalTrigger =
  | "app_root_unmount"
  | "explicit_reload"
  | "performance_replacement"
  | "recovery"
  | "route_view_unmount"
  | "visibility_hidden";

const DISPOSING_TRIGGERS = new Set<RuntimeDisposalTrigger>([
  "app_root_unmount",
  "explicit_reload",
  "performance_replacement",
  "recovery",
]);

export function shouldDisposeRuntimeForTrigger(trigger: RuntimeDisposalTrigger): boolean {
  return DISPOSING_TRIGGERS.has(trigger);
}
