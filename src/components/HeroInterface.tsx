import { motion } from "motion/react";
import { Bar } from "./primitives";
import { landingContent, useI18n } from "@/lib/i18n";

export function HeroInterface() {
  const { locale, t } = useI18n();
  const subjects = landingContent[locale].heroSubjects;

  return (
    <div className="relative grid gap-4 sm:grid-cols-2 lg:grid-cols-[1.1fr_1fr]">
      <motion.div
        initial={{ opacity: 0, y: 30 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 1, delay: 1.1, ease: [0.16, 1, 0.3, 1] }}
        className="glass rounded-2xl p-5"
      >
        <p className="label-mono">{t("landing.yourKnowledge")}</p>
        <div className="mt-6 space-y-5">
          {subjects.map((s) => (
            <div key={s.name}>
              <div className="mb-2 flex items-baseline justify-between">
                <span className="text-sm text-foreground">{s.name}</span>
                <span className="font-mono text-xs text-muted-foreground">{s.value}%</span>
              </div>
              <Bar value={s.value} />
            </div>
          ))}
        </div>
        <div className="mt-6 hairline pt-4">
          <p className="label-mono">{t("landing.nextReview")}</p>
          <p className="mt-2 font-mono text-sm text-foreground">{t("landing.todayTime")}</p>
          <p className="mt-1 font-mono text-xs text-muted-foreground">
            {t("landing.reviewCounts")}
          </p>
        </div>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 30 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 1, delay: 1.25, ease: [0.16, 1, 0.3, 1] }}
        className="glass rounded-2xl p-5"
      >
        <p className="label-mono">{t("overview.aiRecommendation")}</p>
        <p className="mt-4 text-xs text-muted-foreground">
          {t("landing.readyToReview")}
        </p>
        <p className="mt-1 text-lg tracking-tight text-foreground">{t("landing.tcpConcept")}</p>
        <div className="mt-5 grid grid-cols-2 gap-4">
          <div>
            <p className="label-mono">{t("landing.retention")}</p>
            <p className="mt-1 font-mono text-2xl text-lime">61%</p>
          </div>
          <div>
            <p className="label-mono">{t("landing.session")}</p>
            <p className="mt-1 font-mono text-2xl text-foreground">18m</p>
          </div>
        </div>
      </motion.div>

    </div>
  );
}
