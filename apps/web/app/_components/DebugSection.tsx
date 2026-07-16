import type { ReactNode } from "react";

export function DebugSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="fo-card" style={{ padding: 16, marginBottom: 16 }}>
      <h2 style={{ fontSize: 16, margin: "0 0 12px" }}>{title}</h2>
      {children}
    </section>
  );
}

// `technical` applies the shared monospace treatment for genuinely technical
// values (IDs, codes, tiers, timings, backend names) per the brand guide;
// plain-language values (Yes/No, translated labels) leave it off.
export function DebugField({ label, value, technical = false }: { label: string; value: ReactNode; technical?: boolean }) {
  return (
    <div className="fo-ink-field">
      <span className="fo-muted">{label}</span>
      <span className={technical ? "fo-technical-value" : undefined} style={{ textAlign: "right" }}>
        {value}
      </span>
    </div>
  );
}
