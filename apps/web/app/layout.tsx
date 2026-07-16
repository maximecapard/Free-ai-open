import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Header } from "./_components/Header";
import { Footer } from "./_components/Footer";
import { LocaleProvider } from "./_i18n/LocaleContext";
import { ThemeProvider } from "./_theme/ThemeContext";
import { THEME_INIT_SCRIPT } from "./_lib/themePreference";

export const metadata: Metadata = {
  title: "FreeAI Open",
  description: "Local-first open-source browser AI assistant.",
};

// viewportFit: "cover" lets the fixed mobile chat-history trigger read
// env(safe-area-inset-*) so it isn't drawn under a device notch/status bar.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Applies a stored light/dark theme before hydration to avoid a
            flash of the wrong theme. Left unset for "system", which the CSS
            handles via prefers-color-scheme. No user content, no third-party
            code — safe to run synchronously before React mounts. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body>
        <ThemeProvider>
          <LocaleProvider>
            <Header />
            {children}
            <Footer />
          </LocaleProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
