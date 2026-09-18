import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Menu, X } from "lucide-react";
import { NAV_LINKS, SITE } from "@/data/site";
import { useAuth } from "@/hooks/useAuth";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";

const NAV_LABEL_KEYS = [
  "landing.nav.product",
  "landing.nav.how",
  "landing.nav.beta",
  "landing.nav.faq",
] as const;

export function Navbar() {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);
  const { user } = useAuth();
  const { t } = useI18n();

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header
      className={cn(
        "fixed inset-x-0 top-0 z-50 transition-all duration-500",
        scrolled
          ? "border-b border-border bg-background/70 backdrop-blur-xl"
          : "border-b border-transparent",
      )}
    >
      <nav
        aria-label="Main"
        className={cn(
          "shell flex items-center justify-between transition-all duration-500",
          scrolled ? "h-16" : "h-20",
        )}
      >
        <a href="#top" className="text-base font-semibold tracking-[0.24em]">
          {SITE.name}
        </a>

        <ul className="hidden items-center gap-9 lg:flex">
          {NAV_LINKS.map((l, index) => (
            <li key={l.href}>
              <a
                href={l.href}
                className="text-sm text-muted-foreground transition-colors hover:text-foreground"
              >
                {t(NAV_LABEL_KEYS[index] ?? "landing.nav.product")}
              </a>
            </li>
          ))}
        </ul>

        <div className="hidden items-center gap-6 lg:flex">
          <Link
            to={user ? "/app" : "/auth"}
            className="text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            {user ? t("landing.workspace") : t("landing.login")}
          </Link>
          <Link
            to="/app"
            className="group inline-flex items-center gap-2 rounded-full bg-lime px-5 py-2.5 text-sm font-medium text-background transition-all duration-300 hover:shadow-[var(--glow-lime)]"
          >
            {user ? t("landing.continueStudying") : t("landing.startStudying")}
            <span className="transition-transform duration-300 group-hover:translate-x-1">→</span>
          </Link>
        </div>

        <button
          type="button"
          aria-label={open ? t("landing.closeMenu") : t("landing.openMenu")}
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          className="lg:hidden rounded-full border border-border p-2.5"
        >
          {open ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
        </button>
      </nav>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
            className="overflow-hidden border-t border-border bg-background/95 backdrop-blur-xl lg:hidden"
          >
            <ul className="shell flex flex-col gap-1 py-6">
              {NAV_LINKS.map((l, index) => (
                <li key={l.href}>
                  <a
                    href={l.href}
                    onClick={() => setOpen(false)}
                    className="block py-3 text-2xl tracking-tight"
                  >
                    {t(NAV_LABEL_KEYS[index] ?? "landing.nav.product")}
                  </a>
                </li>
              ))}
              <li className="mt-4">
                <Link
                  to="/app"
                  onClick={() => setOpen(false)}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-lime px-5 py-3.5 text-sm font-medium text-background"
                >
                  {user ? t("landing.continueStudying") : t("landing.startStudying")} →
                </Link>
              </li>
            </ul>
          </motion.div>
        )}
      </AnimatePresence>
    </header>
  );
}
