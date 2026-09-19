import { Github, Linkedin } from "lucide-react";
import { SITE, NAV_LINKS } from "@/data/site";
import { useI18n } from "@/lib/i18n";

const NAV_LABEL_KEYS = [
  "landing.nav.product",
  "landing.nav.how",
  "landing.nav.beta",
  "landing.nav.faq",
] as const;

export function Footer() {
  const { t } = useI18n();

  return (
    <footer className="border-t border-border bg-background">
      <div className="shell py-16 md:py-20">
        <div className="grid gap-12 md:grid-cols-12">
          <div className="md:col-span-5">
            <p className="text-base font-semibold tracking-[0.24em]">{SITE.name}</p>
            <p className="mt-6 max-w-xs text-sm leading-relaxed text-muted-foreground">
              {t("landing.footerBody")}
            </p>
          </div>

          <nav className="md:col-span-4" aria-label="Footer">
            <p className="label-mono">{t("landing.product")}</p>
            <ul className="mt-5 space-y-2.5">
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
          </nav>

        </div>

        <div className="mt-16 flex flex-col gap-3 border-t border-border pt-8 md:flex-row md:items-center md:justify-between">
          <p className="font-mono text-[11px] text-muted-foreground">
            © {SITE.year} {SITE.name}. {t("landing.built")}
          </p>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <p className="font-mono text-[11px] text-muted-foreground/60">{t("landing.builtBy")}</p>
            <div className="flex items-center gap-2">
              <a
                href="https://github.com/EnzoMaranezi"
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Enzo Maranezi on GitHub"
                className="text-muted-foreground/60 transition-colors hover:text-foreground"
              >
                <Github className="size-3.5" aria-hidden="true" />
              </a>
              <a
                href="https://www.linkedin.com/in/enzo-maranezi"
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Enzo Maranezi on LinkedIn"
                className="text-muted-foreground/60 transition-colors hover:text-foreground"
              >
                <Linkedin className="size-3.5" aria-hidden="true" />
              </a>
            </div>
            <p className="font-mono text-[11px] text-muted-foreground/60">{t("landing.agent")}</p>
          </div>
        </div>
      </div>
    </footer>
  );
}
