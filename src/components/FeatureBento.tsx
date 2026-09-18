import { useRef } from "react";
import { motion } from "motion/react";
import { Reveal, SectionLabel, Bar } from "./primitives";
import { useScrollTilt3D } from "@/animations/tilt3d";
import { useI18n } from "@/lib/i18n";

function Card({
  children,
  className = "",
  label,
  title,
}: {
  children?: React.ReactNode;
  className?: string;
  label: string;
  title: string;
}) {
  return (
    <article
      data-bento-card
      className={`group flex flex-col rounded-2xl border border-border bg-surface/60 p-6 transition-all duration-500 hover:-translate-y-1 hover:border-lime/25 md:p-8 ${className}`}
    >
      <span className="label-mono">{label}</span>
      <h3 className="mt-4 max-w-[22ch] text-xl leading-snug tracking-tight md:text-2xl">{title}</h3>
      {children ? <div className="mt-7 flex-1">{children}</div> : null}
    </article>
  );
}

export function FeatureBento() {
  const { t } = useI18n();
  const ref = useRef<HTMLDivElement>(null);
  useScrollTilt3D(ref, "[data-bento-card]", { rotateX: 10, rotateY: -6, z: -60 });

  return (
    <section className="shell py-28 md:py-40">
      <SectionLabel>{t("landing.featureLabel")}</SectionLabel>
      <Reveal>
        <h2 className="display-sm mt-7 max-w-[16ch]">
          {t("landing.featureTitle")} <span className="editorial">{t("landing.featureHighlight")}</span>
        </h2>
      </Reveal>

      <div ref={ref} className="mt-16 grid gap-4 lg:grid-cols-6">
        <Card
          label={t("landing.aiTutorLabel")}
          title={t("landing.aiTutorTitle")}
          className="lg:col-span-6"
        >
          <div className="space-y-3">
            <div className="ml-auto max-w-sm rounded-2xl rounded-br-sm border border-border bg-surface-2 p-4 text-sm leading-relaxed">
              {t("landing.aiTutorQuestion")}
            </div>
            <div className="max-w-md rounded-2xl rounded-bl-sm border border-lime/20 bg-surface-3 p-4 text-sm leading-relaxed">
              {t("landing.aiTutorAnswer")}
              <span className="mt-3 block font-mono text-[11px] text-lime">
                {t("landing.aiTutorSource")}
              </span>
            </div>
          </div>
        </Card>


        <Card label={t("landing.flashcardsLabel")} title={t("landing.flashcardsTitle")} className="lg:col-span-2">
          <div className="rounded-xl border border-border bg-surface-2 p-6">
            <p className="text-base leading-snug">{t("landing.flashcardsQuestion")}</p>
            <p className="mt-6 font-mono text-[11px] uppercase tracking-[0.2em] text-lime">{t("landing.reveal")}</p>
          </div>
        </Card>

        <Card label={t("landing.activeRecallLabel")} title={t("landing.activeRecallTitle")} className="lg:col-span-2">
          <div className="grid grid-cols-3 gap-4">
            {[
              ["12", t("overview.questions")],
              ["03", t("landing.weakAreas")],
              ["08", t("landing.minutes")],
            ].map(([v, l]) => (
              <div key={l}>
                <p className="font-mono text-2xl text-foreground">{v}</p>
                <p className="label-mono mt-1">{l}</p>
              </div>
            ))}
          </div>
        </Card>

        <Card label={t("landing.adaptiveReviewLabel")} title={t("landing.adaptiveReviewTitle")} className="lg:col-span-2">
          <ol className="space-y-2.5">
            {[t("landing.learned"), t("landing.review"), t("landing.forgot"), t("landing.reinforce"), t("landing.mastered")].map((s, i) => (
              <li key={s} className="flex items-center gap-3">
                <span
                  className={`h-1.5 w-1.5 rounded-full ${i === 4 ? "bg-lime" : "bg-muted-foreground/40"}`}
                  aria-hidden
                />
                <span
                  className={`font-mono text-[11px] uppercase tracking-[0.18em] ${i === 4 ? "text-lime" : "text-muted-foreground"}`}
                >
                  {s}
                </span>
              </li>
            ))}
          </ol>
        </Card>

        <Card
          label={t("landing.academicMemoryLabel")}
          title={t("landing.academicMemoryTitle")}
          className="lg:col-span-6"
        >
          <div className="grid gap-8 md:grid-cols-2 md:items-center">
            <ul className="space-y-3 text-sm text-muted-foreground">
              {[
                t("landing.memoryStudied"),
                t("landing.memoryStruggle"),
                t("landing.memoryKnow"),
                t("landing.memoryNext"),
              ].map((t) => (
                <motion.li
                  key={t}
                  initial={{ opacity: 0, x: -10 }}
                  whileInView={{ opacity: 1, x: 0 }}
                  viewport={{ once: true }}
                  transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
                  className="flex items-center gap-3"
                >
                  <span className="h-px w-6 bg-lime/60" aria-hidden />
                  {t}
                </motion.li>
              ))}
            </ul>
            <div className="space-y-4">
              {[
                [t("landing.longTermRetention"), 76],
                [t("landing.conceptCoverage"), 88],
                [t("landing.reviewAdherence"), 91],
              ].map(([l, v]) => (
                <div key={l as string}>
                  <div className="mb-2 flex justify-between font-mono text-[11px] text-muted-foreground">
                    <span>{l}</span>
                    <span>{v}%</span>
                  </div>
                  <Bar value={v as number} />
                </div>
              ))}
            </div>
          </div>
        </Card>
      </div>
    </section>
  );
}
