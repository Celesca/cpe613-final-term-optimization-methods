"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ThemeToggle } from "./ThemeToggle";

const LINKS = [
  { href: "/", label: "Simulator" },
  { href: "/data", label: "Data & results" },
  { href: "/about", label: "Model & API" },
] as const;

export function Nav() {
  const path = usePathname();
  return (
    <nav className="topnav">
      <span className="brand">Debt Collection Optimizer <span className="th">ระบบจัดสรรกลยุทธ์การติดตามหนี้</span></span>
      <div className="links">
        {LINKS.map((l) => (
          <Link key={l.href} href={l.href} className={path === l.href ? "active" : ""}>{l.label}</Link>
        ))}
        <ThemeToggle />
      </div>
    </nav>
  );
}
