import type { ReactNode } from "react";

export function DebugSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="fo-card" style={{ padding: 16, marginBottom: 16 }}>
      <h2 style={{ fontSize: 16, margin: "0 0 12px" }}>{title}</h2>
      {children}
    </section>
  );
}

export function DebugField({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        gap: 12,
        fontSize: 14,
        padding: "4px 0",
        borderBottom: "1px solid var(--color-border-subtle)",
      }}
    >
      <span style={{ opacity: 0.65 }}>{label}</span>
      <span style={{ textAlign: "right" }}>{value}</span>
    </div>
  );
}
