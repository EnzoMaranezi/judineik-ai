import { useQueryClient } from "@tanstack/react-query";
import { AccountDeletionForm } from "@/components/app/AccountDeletionForm";
import { AppCard, AppLabel, GhostButton } from "@/components/app/ui";
import { clearNexaBrowserState } from "@/lib/account-deletion-client";
import { useI18n } from "@/lib/i18n";
import { setPasswordRecoveryPending } from "@/hooks/useAuth";
import { supabase } from "@/lib/supabase";

export function AccountDeletionPending({ email, userId }: { email: string; userId: string }) {
  const { t } = useI18n();
  const queryClient = useQueryClient();

  async function finishAccountDeletion() {
    await queryClient.cancelQueries();
    queryClient.clear();
    clearNexaBrowserState();
    setPasswordRecoveryPending(false);
    await supabase.auth.signOut({ scope: "local" }).catch(() => undefined);
    window.location.replace("/");
  }

  async function signOut() {
    await queryClient.cancelQueries();
    queryClient.clear();
    clearNexaBrowserState();
    setPasswordRecoveryPending(false);
    await supabase.auth.signOut({ scope: "local" }).catch(() => undefined);
    window.location.replace("/");
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-xl items-center px-5 py-10">
      <AppCard className="w-full border-destructive/35">
        <AppLabel>{t("settings.deleteAccountPendingTitle")}</AppLabel>
        <p className="mt-4 text-lg tracking-tight">{t("settings.deleteAccountPendingTitle")}</p>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{t("settings.deleteAccountPending")}</p>
        <AccountDeletionForm email={email} userId={userId} pending onDeleted={finishAccountDeletion} />
        <GhostButton className="mt-3" onClick={() => void signOut()}>
          {t("settings.deleteAccountSignOut")}
        </GhostButton>
      </AppCard>
    </main>
  );
}
