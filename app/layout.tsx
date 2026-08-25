import type { Metadata } from "next";
import { Archivo, Azeret_Mono } from "next/font/google";
import "./globals.css";
import Link from "next/link";
import { PRODUCT, PRODUCT_TAGLINE, SUITE } from "@/lib/brand.ts";

const archivo = Archivo({
  subsets: ["latin"], weight: ["400", "500", "600", "700", "800"],
  variable: "--font-archivo", display: "swap",
});
const azeret = Azeret_Mono({
  subsets: ["latin"], weight: ["400", "500", "600"],
  variable: "--font-azeret", display: "swap",
});

export const metadata: Metadata = {
  title: `${PRODUCT} — ${PRODUCT_TAGLINE}`,
  description:
    "What trade-in programmes pay, what devices sell for by channel, and the spread between them. A SuperIQ engine.",
};

const NAV = [
  { href: "/", label: "Overview" },
  { href: "/programs", label: "Programmes" },
  { href: "/devices", label: "Devices" },
  { href: "/compare", label: "Compare" },
];

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${archivo.variable} ${azeret.variable}`}>
      <body>
        <header className="border-b border-[var(--border)] bg-[color-mix(in_srgb,var(--card)_94%,transparent)] backdrop-blur-xl">
          <div className="mx-auto flex max-w-[1400px] items-center gap-7 px-6 py-3">
            <Link href="/" className="flex shrink-0 items-center gap-2.5">
              <div className="brandmark h-9 w-9 text-[13px]">S</div>
              <div className="leading-tight">
                <div className="text-[15px] font-extrabold tracking-tight">
                  {PRODUCT}
                </div>
                <div className="text-[11px] text-[var(--muted)]">{PRODUCT_TAGLINE}</div>
              </div>
            </Link>
            <nav className="flex gap-5 text-[13px]">
              {NAV.map((n) => (
                <Link key={n.href} href={n.href} className="text-[var(--muted)] hover:text-[var(--text)]">
                  {n.label}
                </Link>
              ))}
            </nav>
            <div className="ml-auto flex items-center gap-3">
              <span className="mono text-[10px] uppercase tracking-[.16em] text-[var(--muted)]">
                US · UAE · India
              </span>
              <span
                className="mono px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[.14em] text-white"
                style={{ background: "var(--grad)" }}
              >
                {SUITE}
              </span>
            </div>
          </div>
        </header>
        <main className="mx-auto max-w-[1400px] px-6 py-7">{children}</main>
        <footer className="mt-12 border-t border-[var(--border)] py-6">
          <div className="mx-auto max-w-[1400px] px-6 text-[11.5px] text-[var(--muted)]">
            <b className="text-[var(--text)]">{PRODUCT}</b> — a {SUITE} engine. Buy and sell against live market data.
          </div>
        </footer>
      </body>
    </html>
  );
}
