import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "FreeAI Open",
  description: "Local-first open-source browser AI assistant.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
