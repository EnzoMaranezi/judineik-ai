import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AlertCircle, CheckCircle2 } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { AppCard, AppLabel, PrimaryButton } from "@/components/app/ui";
import { AccountDeletionForm } from "@/components/app/AccountDeletionForm";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { clearNexaBrowserState } from "@/lib/account-deletion-client";
import { getUserLocale, SUPPORTED_LOCALES, translate, type Locale, useI18n } from "@/lib/i18n";
import { setPasswordRecoveryPending, useAuth } from "@/hooks/useAuth";
import { supabase } from "@/lib/supabase";
import {
  authErrorMessage,
  updateDisplayName,
  updateLanguagePreference,
  updatePassword,
} from "@/services/authService";
import { getAiGenerationUsageToday, type AiGenerationUsage } from "@/services/aiUsageService";

export const Route = createFileRoute("/app/settings")({
  head: () => ({
    meta: [
      { title: "Settings - NEXA Workspace" },
      { name: "description", content: "Manage your NEXA account settings." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: SettingsPage,
});

function SettingsPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { locale, setLocale, t } = useI18n();
  const [name, setName] = useState("");
  const [selectedLocale, setSelectedLocale] = useState<Locale>(locale);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [aiUsage, setAiUsage] = useState<AiGenerationUsage | null>(null);
  const [busy, setBusy] = useState<"name" | "language" | "password" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deletionLocked, setDeletionLocked] = useState(false);

  useEffect(() => {
    setName(readDisplayName(user?.user_metadata) ?? "");
    setSelectedLocale(locale);
  }, [locale, user]);

  useEffect(() => {
    let cancelled = false;
    if (!user) {
      setAiUsage(null);
      return;
    }

    getAiGenerationUsageToday()
      .then((usage) => {
        if (!cancelled) setAiUsage(usage);
      })
      .catch(() => {
        if (!cancelled) setAiUsage(null);
      });

    return () => {
      cancelled = true;
    };
  }, [user]);

  async function saveName() {
    const trimmed = name.trim();
    setError(null);
    setNotice(null);
    if (!trimmed) {
      setError(t("settings.nameRequired"));
      return;
    }
    setBusy("name");
    try {
      await updateDisplayName(trimmed);
      setNotice(t("settings.nameSaved"));
    } catch (err) {
      setError(authErrorMessage(err, t, t("settings.nameError")));
    } finally {
      setBusy(null);
    }
  }

  async function saveLanguage() {
    setError(null);
    setNotice(null);
    setLocale(selectedLocale);
    setBusy("language");
    try {
      await updateLanguagePreference(selectedLocale);
      setNotice(translate(selectedLocale, "settings.languageSaved"));
    } catch (err) {
      setLocale(locale);
      setError(authErrorMessage(err, t, t("settings.languageError")));
    } finally {
      setBusy(null);
    }
  }

  async function savePassword() {
    setError(null);
    setNotice(null);
    if (!newPassword || !confirmPassword) {
      setError(t("settings.passwordRequired"));
      return;
    }
    if (newPassword.length < 6) {
      setError(t("settings.passwordLength"));
      return;
    }
    if (newPassword !== confirmPassword) {
      setError(t("settings.passwordMismatch"));
      return;
    }

    setBusy("password");
    try {
      await updatePassword(newPassword);
      setNewPassword("");
      setConfirmPassword("");
      setNotice(t("settings.passwordSaved"));
    } catch (err) {
      setError(authErrorMessage(err, t, t("settings.passwordError")));
    } finally {
      setBusy(null);
    }
  }

  async function finishAccountDeletion() {
    await queryClient.cancelQueries();
    queryClient.clear();
    clearNexaBrowserState();
    setPasswordRecoveryPending(false);
    await supabase.auth.signOut({ scope: "local" }).catch(() => undefined);
    window.location.replace("/");
  }

  return (
    <div className="mx-auto max-w-[960px] space-y-8">
      <header>
        <AppLabel>{t("settings.title")}</AppLabel>
        <h1 className="display-sm mt-4">{t("settings.title")}</h1>
        <p className="mt-4 max-w-md text-sm leading-relaxed text-muted-foreground">
          {t("settings.description")}
        </p>
      </header>

      {error ? <Feedback tone="error" message={error} /> : null}
      {notice ? <Feedback tone="success" message={notice} /> : null}

      <section className="grid gap-5">
        <AppCard>
          <AppLabel>{t("settings.account")}</AppLabel>
          <div className="mt-6 grid gap-5">
            <div>
              <label htmlFor="name" className="label-mono">
                {t("settings.name")}
              </label>
              <div className="mt-2 flex flex-wrap gap-3">
                <input
                  id="name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  className="min-w-0 flex-1 rounded-xl border border-border bg-surface-2/60 px-4 py-3 text-sm outline-none focus:border-lime/40"
                />
                <PrimaryButton onClick={() => void saveName()} disabled={busy !== null}>
                  {busy === "name" ? t("settings.saving") : t("settings.saveName")}
                </PrimaryButton>
              </div>
            </div>

            <div>
              <p className="label-mono">{t("settings.email")}</p>
              <p className="mt-2 rounded-xl border border-border bg-surface-2/40 px-4 py-3 text-sm text-muted-foreground">
                {user?.email ?? ""}
              </p>
            </div>

            <div className="border-t border-border pt-5">
              <AppLabel>{t("settings.changePassword")}</AppLabel>
              <div className="mt-4 grid gap-3 md:grid-cols-2">
                <input
                  type="password"
                  autoComplete="new-password"
                  value={newPassword}
                  onChange={(event) => setNewPassword(event.target.value)}
                  placeholder={t("settings.newPassword")}
                  className="rounded-xl border border-border bg-surface-2/60 px-4 py-3 text-sm outline-none placeholder:text-muted-foreground focus:border-lime/40"
                />
                <input
                  type="password"
                  autoComplete="new-password"
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  placeholder={t("settings.confirmPassword")}
                  className="rounded-xl border border-border bg-surface-2/60 px-4 py-3 text-sm outline-none placeholder:text-muted-foreground focus:border-lime/40"
                />
              </div>
              <PrimaryButton
                className="mt-4"
                onClick={() => void savePassword()}
                disabled={busy !== null}
              >
                {busy === "password" ? t("settings.saving") : t("settings.updatePassword")}
              </PrimaryButton>
            </div>
          </div>
        </AppCard>

        <AppCard>
          <AppLabel>{t("settings.language")}</AppLabel>
          <label htmlFor="language" className="mt-5 block text-sm text-muted-foreground">
            {t("settings.applicationLanguage")}
          </label>
          <div className="mt-3 flex flex-wrap gap-3">
            <select
              id="language"
              value={selectedLocale}
              onChange={(event) => setSelectedLocale(event.target.value as Locale)}
              className="min-w-56 rounded-xl border border-border bg-surface-2/60 px-4 py-3 text-sm outline-none focus:border-lime/40"
            >
              {SUPPORTED_LOCALES.map((option) => (
                <option key={option} value={option}>
                  {option === "pt-BR" ? t("settings.languagePortuguese") : t("settings.languageEnglish")}
                </option>
              ))}
            </select>
            <PrimaryButton onClick={() => void saveLanguage()} disabled={busy !== null}>
              {busy === "language" ? t("settings.saving") : t("settings.saveLanguage")}
            </PrimaryButton>
          </div>
        </AppCard>

        <AppCard>
          <AppLabel>{t("settings.aiUsage")}</AppLabel>
          <div className="mt-5 flex flex-wrap items-center justify-between gap-4 rounded-xl border border-border bg-surface-2/40 px-4 py-4">
            <div>
              <p className="text-sm text-muted-foreground">
                {t("settings.aiGenerationsToday")}:{" "}
                {aiUsage
                  ? t("settings.aiGenerationsUsage", {
                      used: aiUsage.used,
                      limit: aiUsage.limit,
                    })
                  : t("common.loading")}
              </p>
            </div>
          </div>
        </AppCard>

        <AppCard className="border-destructive/35">
          <AppLabel>{t("settings.deleteAccount")}</AppLabel>
          <div className="mt-5 flex flex-wrap items-end justify-between gap-5">
            <div className="max-w-xl">
              <p className="text-sm leading-relaxed text-muted-foreground">
                {t("settings.deleteAccountDescription")}
              </p>
              <p className="mt-2 text-sm font-medium text-destructive">{t("settings.deleteAccountWarning")}</p>
            </div>
            <button
              type="button"
              onClick={() => setDeleteDialogOpen(true)}
              className="inline-flex min-h-11 items-center justify-center rounded-full border border-destructive/50 px-5 py-2.5 text-sm font-medium text-destructive transition-colors hover:bg-destructive/10"
            >
              {t("settings.deleteAccount")}
            </button>
          </div>
        </AppCard>
      </section>

      <AlertDialog open={deleteDialogOpen} onOpenChange={(open) => !deletionLocked && setDeleteDialogOpen(open)}>
        <AlertDialogContent onEscapeKeyDown={(event) => {
          if (deletionLocked) event.preventDefault();
        }}>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("settings.deleteAccountDialogTitle")}</AlertDialogTitle>
            <AlertDialogDescription>{t("settings.deleteAccountDialogDescription")}</AlertDialogDescription>
          </AlertDialogHeader>
          {user?.email && user.id ? (
            <AccountDeletionForm
              email={user.email}
              userId={user.id}
              onDeleted={finishAccountDeletion}
              onLockedChange={setDeletionLocked}
            />
          ) : null}
          <div className="flex justify-end">
            <AlertDialogCancel disabled={deletionLocked}>{t("common.cancel")}</AlertDialogCancel>
          </div>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function readDisplayName(metadata: Record<string, unknown> | undefined) {
  const fullName = metadata?.["full_name"];
  const name = metadata?.["name"];
  return typeof fullName === "string" ? fullName : typeof name === "string" ? name : null;
}

function Feedback({ tone, message }: { tone: "error" | "success"; message: string }) {
  const Icon = tone === "error" ? AlertCircle : CheckCircle2;
  return (
    <p
      role={tone === "error" ? "alert" : "status"}
      className={`flex items-center gap-2 rounded-xl border px-4 py-3 text-sm ${
        tone === "error"
          ? "border-destructive/40 bg-destructive/10"
          : "border-lime/30 bg-lime/10"
      }`}
    >
      <Icon className={tone === "error" ? "size-4 text-destructive" : "size-4 text-lime"} />
      {message}
    </p>
  );
}
