import type { Metadata } from "next";
import { Archivo, Spline_Sans_Mono } from "next/font/google";

import "./globals.css";

const sans = Archivo({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});

const mono = Spline_Sans_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "goBuy — Compras Vammo",
  description: "Solicitações de compra, aprovações e pagamentos da Vammo.",
};

/** Applies the saved theme before paint — no flash of wrong theme. */
const themeBootstrap = `(function(){try{var t=localStorage.getItem("gobuy-theme");var d=t? t==="dark":window.matchMedia("(prefers-color-scheme: dark)").matches;if(d)document.documentElement.classList.add("dark");}catch(e){}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeBootstrap }} />
      </head>
      <body className={`${sans.variable} ${mono.variable} min-h-screen`}>
        <div className="volt-thread" />
        {children}
      </body>
    </html>
  );
}
