import { Languages } from "lucide-react";
import { GhostButton, PrimaryButton } from "@/components/app/ui";
import { useI18n, type Locale, type PersistedContentLocale } from "@/lib/i18n";

type Variant = { locale: PersistedContentLocale };

function noticeKey(locale: PersistedContentLocale) {
  if (locale === "en") return "contentLanguage.generatedInEnglish";
  if (locale === "pt-BR") return "contentLanguage.generatedInPortuguese";
  return "contentLanguage.legacy";
}

function openKey(locale: PersistedContentLocale) {
  if (locale === "en") return "contentLanguage.openEnglish";
  if (locale === "pt-BR") return "contentLanguage.openPortuguese";
  return "contentLanguage.openLegacy";
}

function generateKey(locale: Locale) {
  return locale === "pt-BR"
    ? "contentLanguage.generatePortuguese"
    : "contentLanguage.generateEnglish";
}

export function GeneratedContentLanguageState({
  currentLocale,
  variants,
  generating,
  onGenerate,
  onOpen,
  generationDisabled = false,
}: {
  currentLocale: Locale;
  variants: Variant[];
  generating: boolean;
  onGenerate: () => void;
  onOpen: (locale: PersistedContentLocale) => void;
  generationDisabled?: boolean;
}) {
  const { t } = useI18n();
  const primaryVariant = variants.find((variant) => variant.locale !== "und") ?? variants[0];

  return (
    <div className="mt-6 rounded-xl border border-border bg-surface-2/50 p-4">
      <p className="flex items-center gap-2 text-sm">
        <Languages className="size-4 text-lime" aria-hidden />
        {primaryVariant ? t(noticeKey(primaryVariant.locale)) : null}
      </p>
      <div className="mt-4 flex flex-wrap gap-3">
        <PrimaryButton onClick={onGenerate} disabled={generating || generationDisabled}>
          {t(generateKey(currentLocale))}
        </PrimaryButton>
        {variants.map((variant) => (
          <GhostButton key={variant.locale} onClick={() => onOpen(variant.locale)}>
            {t(openKey(variant.locale))}
          </GhostButton>
        ))}
      </div>
    </div>
  );
}
