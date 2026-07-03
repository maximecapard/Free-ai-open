import Link from "next/link";

export function Header() {
  return (
    <header
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        maxWidth: 960,
        margin: "0 auto",
        padding: "20px 24px",
      }}
    >
      <Link href="/" style={{ fontWeight: 600, textDecoration: "none" }}>
        FreeAI Open
      </Link>
      <nav style={{ display: "flex", gap: 20, fontSize: 14, opacity: 0.8 }}>
        <Link href="/settings">Settings</Link>
        <Link href="/debug">Debug</Link>
      </nav>
    </header>
  );
}
