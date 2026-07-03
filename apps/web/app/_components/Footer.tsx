const sponsorsUrl = process.env.NEXT_PUBLIC_GITHUB_SPONSORS_URL;
const coffeeUrl = process.env.NEXT_PUBLIC_BUY_ME_A_COFFEE_URL;

export function Footer() {
  return (
    <footer
      style={{
        maxWidth: 960,
        margin: "0 auto",
        padding: "24px 24px 48px",
        display: "flex",
        justifyContent: "space-between",
        gap: 16,
        fontSize: 13,
        opacity: 0.6,
        flexWrap: "wrap",
      }}
    >
      <span>FreeAI Open — open-source, local-first AI.</span>
      {(sponsorsUrl || coffeeUrl) && (
        <span style={{ display: "flex", gap: 12 }}>
          {sponsorsUrl && <a href={sponsorsUrl}>Support the project</a>}
          {coffeeUrl && <a href={coffeeUrl}>Buy me a coffee</a>}
        </span>
      )}
    </footer>
  );
}
