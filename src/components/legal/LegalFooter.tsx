import { Link } from "react-router-dom";
import { legal } from "@/config/legal";

const LINKS = [
  { to: "/about", label: "About & pricing" },
  { to: "/terms", label: "Terms" },
  { to: "/privacy", label: "Privacy" },
  { to: "/refunds", label: "Refunds" },
  { to: "/delivery", label: "Delivery" },
  { to: "/contact", label: "Contact" },
];

export function LegalFooter({ compact = false }: { compact?: boolean }) {
  return (
    <footer className={compact ? "py-3" : "border-t py-6"}>
      <div className={compact ? "flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground" : "container mx-auto px-4 flex flex-col md:flex-row items-center justify-between gap-3 text-sm text-muted-foreground"}>
        {!compact && <p>© {new Date().getFullYear()} {legal.brand}. Not affiliated with UPSC.</p>}
        <nav aria-label="Legal" className="flex flex-wrap gap-x-4 gap-y-1">
          {LINKS.map((l) => (
            <Link key={l.to} to={l.to} className="hover:text-foreground hover:underline">
              {l.label}
            </Link>
          ))}
        </nav>
      </div>
    </footer>
  );
}
