import type { Metadata } from "next";
import { Instrument_Serif, Inter, JetBrains_Mono } from "next/font/google";
import { AuthProvider } from "../lib/auth-context";
import { ThemeProvider } from "../lib/theme-context";
import { UsageProvider } from "../lib/usage";
import { Splash } from "../components/splash";
import "./globals.css";

/**
 * A high-contrast serif display against a neutral sans body — the type pairing
 * carries most of the app's "paper and ink" character.
 */
const display = Instrument_Serif({
  subsets: ["latin"],
  weight: "400",
  style: ["normal", "italic"],
  variable: "--font-display",
  display: "swap",
});

const body = Inter({
  subsets: ["latin"],
  variable: "--font-body",
  display: "swap",
});

const mono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Underleaf — Résumés that look considered",
  description:
    "Pick a professionally typeset template, edit it like a document, and export a pixel-perfect PDF. No LaTeX, no code.",
};

// Runs before first paint to set the `.dark` class from the stored preference
// (or the OS setting), so a dark-mode user never sees a flash of the light
// chrome. Kept as a compact string since it must be inline and blocking.
const NO_FLASH_SCRIPT = `(function(){try{var k="underleaf-theme";var s=localStorage.getItem(k);var d=s?s==="dark":(s==="light"?false:matchMedia("(prefers-color-scheme:dark)").matches);var e=document.documentElement;e.classList.toggle("dark",d);e.style.colorScheme=d?"dark":"light";}catch(e){}})();`;

/**
 * Decides whether the splash plays, before anything paints.
 *
 * It plays on every load of the home page and nowhere else. The path check is
 * what scopes it: this script is in the root layout, so it runs for every
 * document, and `/` is the only route the overlay is wanted on — landing
 * straight in the editor or the dashboard should never be held behind an
 * animation. There is no "seen" flag, because a title card that plays once
 * ever is invisible to everyone who has already visited.
 *
 * Running ahead of the splash markup in the document is the point: on a
 * non-home route the attribute is simply never set, so the CSS keeps the
 * overlay at display:none and the page is never covered for even one frame.
 * The timeout clears the attribute just after the CSS fade ends, which removes
 * the overlay from the layout and unlocks scrolling.
 *
 * Only a document load reaches this, so an in-app click through to `/` does not
 * replay it — the splash belongs to opening the app, not to moving around
 * inside it.
 */
const SPLASH_SCRIPT = `(function(){try{if(location.pathname!=="/")return;if(matchMedia("(prefers-reduced-motion: reduce)").matches)return;var e=document.documentElement;e.setAttribute("data-splash","run");setTimeout(function(){e.removeAttribute("data-splash")},2380);}catch(e){}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      // The pre-paint script sets `.dark`, so the server/client class differs by
      // design; suppress the resulting hydration mismatch warning on <html>.
      suppressHydrationWarning
      className={`${display.variable} ${body.variable} ${mono.variable}`}
    >
      <body className="min-h-screen bg-paper font-sans text-ink antialiased">
        {/* First in <body> so they run synchronously before any chrome paints,
            and before the splash markup below is parsed. */}
        <script dangerouslySetInnerHTML={{ __html: NO_FLASH_SCRIPT }} />
        <script dangerouslySetInnerHTML={{ __html: SPLASH_SCRIPT }} />
        <Splash />
        <ThemeProvider>
          {/* Inside AuthProvider, which it reads to know whose allowance to
              fetch — and to drop it again on sign-out. */}
          <AuthProvider>
            <UsageProvider>{children}</UsageProvider>
          </AuthProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
