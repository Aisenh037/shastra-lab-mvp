import { ReactNode, useEffect } from "react";
import { Link, NavLink } from "react-router-dom";
import { GraduationCap, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import { legal, legalDetailsIncomplete, POLICY_EFFECTIVE_DATE } from "@/config/legal";
import { LegalFooter } from "./LegalFooter";

export const LEGAL_LINKS = [
  { to: "/about", label: "About & pricing" },
  { to: "/terms", label: "Terms" },
  { to: "/privacy", label: "Privacy" },
  { to: "/refunds", label: "Refunds & cancellation" },
  { to: "/delivery", label: "Delivery" },
  { to: "/contact", label: "Contact" },
];

export function LegalLayout({ title, children, dated = true }: { title: string; children: ReactNode; dated?: boolean }) {
  useEffect(() => {
    document.title = `${title} · ${legal.brand}`;
    window.scrollTo(0, 0);
  }, [title]);

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <header className="border-b">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between gap-4">
          <Link to="/" className="flex items-center gap-2 font-display font-bold text-lg">
            <GraduationCap className="h-6 w-6 text-primary" /> {legal.brand}
          </Link>
          <Link to="/auth" className="text-sm font-medium text-primary hover:underline">Sign in</Link>
        </div>
      </header>
      <div className="container mx-auto px-4 py-8 flex-1 grid gap-8 lg:grid-cols-[200px_1fr]">
        <nav aria-label="Policies" className="flex flex-wrap gap-2 lg:flex-col lg:gap-1 text-sm">
          {LEGAL_LINKS.map((l) => (
            <NavLink
              key={l.to}
              to={l.to}
              className={({ isActive }) =>
                cn("rounded-md px-3 py-2 hover:bg-accent", isActive ? "bg-accent font-semibold" : "text-muted-foreground")
              }
            >
              {l.label}
            </NavLink>
          ))}
        </nav>
        <main className="max-w-3xl">
          {legalDetailsIncomplete && (
            <div role="note" className="mb-6 flex gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
              <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
              <span>Draft: some business details below are placeholders and will be filled in before launch.</span>
            </div>
          )}
          <h1 className="text-3xl font-display font-bold mb-2">{title}</h1>
          {dated && <p className="text-sm text-muted-foreground mb-8">Effective {POLICY_EFFECTIVE_DATE}</p>}
          <div className="space-y-4 leading-relaxed text-[15px]">{children}</div>
        </main>
      </div>
      <LegalFooter />
    </div>
  );
}

export const H2 = ({ children, id }: { children: ReactNode; id?: string }) => (
  <h2 id={id} className="text-xl font-semibold pt-6">{children}</h2>
);
export const UL = ({ children }: { children: ReactNode }) => <ul className="list-disc pl-6 space-y-1">{children}</ul>;
export const A = ({ href, children }: { href: string; children: ReactNode }) =>
  href.startsWith("/") ? (
    <Link to={href} className="text-primary underline underline-offset-2">{children}</Link>
  ) : (
    <a href={href} className="text-primary underline underline-offset-2" target={href.startsWith("http") ? "_blank" : undefined} rel="noopener noreferrer">{children}</a>
  );
