import type { Metadata } from "next";
import { Instrument_Serif, Inter, JetBrains_Mono } from "next/font/google";
import { AuthProvider } from "../lib/auth-context";
import { ThemeProvider } from "../lib/theme-context";
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
 * Decides whether the first-run splash plays, before anything paints.
 *
 * Runs ahead of the splash markup in the document, so a returning visitor's
 * page is never covered for even one frame — the attribute is simply never
 * set and the CSS keeps the overlay at display:none. Marking it seen up front
 * (rather than when the animation ends) means a reload mid-animation doesn't
 * replay it. localStorage rather than sessionStorage: the ask was once only,
 * not once per tab. The timeout clears the attribute just after the CSS fade
 * ends, which removes the overlay from the layout and unlocks scrolling.
 */
const SPLASH_SCRIPT = `(function(){try{var k="underleaf-splash-seen";if(localStorage.getItem(k))return;localStorage.setItem(k,"1");if(matchMedia("(prefers-reduced-motion: reduce)").matches)return;var e=document.documentElement;e.setAttribute("data-splash","run");setTimeout(function(){e.removeAttribute("data-splash")},2380);}catch(e){}})();`;

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
          <AuthProvider>{children}</AuthProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
