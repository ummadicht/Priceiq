import type { Metadata } from "next";
import "./globals.css";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Trade-in price intelligence",
  description: "What programmes pay, what devices sell for, and the spread between them.",
};

const NAV = [
  { href: "/", label: "Overview" },
  { href: "/programs", label: "Programmes" },
  { href: "/devices", label: "Devices" },
  { href: "/compare", label: "Compare" },
];

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="border-b border-[var(--line)] bg-white">
          <div className="mx-auto flex max-w-[1400px] items-center gap-8 px-6 py-3">
            <Link href="/" className="text-[15px] font-extrabold tracking-tight">
              Trade-in <span className="text-[var(--muted)]">intelligence</span>
            </Link>
            <nav className="flex gap-5 text-[13px]">
              {NAV.map((n) => (
                <Link key={n.href} href={n.href} className="text-[var(--muted)] hover:text-[var(--ink)]">
                  {n.label}
                </Link>
              ))}
            </nav>
            <span className="ml-auto text-[11px] text-[var(--muted)]">US · UAE · India</span>
          </div>
        </header>
        <main className="mx-auto max-w-[1400px] px-6 py-7">{children}</main>
      </body>
    </html>
  );
}
