import type { Metadata } from "next";
import { Inter } from "next/font/google";

import "./globals.css";

// Vammo DS product track: Inter for all product UI (Supria Sans is
// brand-track / design-preview only — Monotype license).
const sans = Inter({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});

export const metadata: Metadata = {
  title: "goBuy — Compras Vammo",
  description: "Solicitações de compra, aprovações e pagamentos da Vammo.",
};

/** Applies the saved theme before paint — no flash of wrong theme. */
const themeBootstrap = `(function(){try{var t=localStorage.getItem("gobuy-theme");var d=t? t==="dark":window.matchMedia("(prefers-color-scheme: dark)").matches;if(d)document.documentElement.classList.add("dark");}catch(e){}})();`;

/** Applies the saved ambient-effect mode before paint (circuit | aurora | off,
 *  default circuit). Migrates the legacy on/off value ("on" → aurora). */
const fxBootstrap = `(function(){try{var f=localStorage.getItem("gobuy-fx");if(f==="on")f="aurora";if(!f)f="circuit";var c=document.documentElement.classList;if(f==="aurora")c.add("fx-aurora");else if(f!=="off")c.add("fx-circuit");}catch(e){document.documentElement.classList.add("fx-circuit");}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeBootstrap }} />
        <script dangerouslySetInnerHTML={{ __html: fxBootstrap }} />
      </head>
      <body className={`${sans.variable} min-h-screen`}>
        <div className="aurora" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
        <div className="circuit" aria-hidden="true">
          <div className="circuit-grid" />
          <div className="circuit-glow" />
          <div className="circuit-flow">
            <span />
            <span />
            <span />
            <span />
            <span />
          </div>
        </div>
        <div className="brand-thread" />
        {children}
      </body>
    </html>
  );
}
