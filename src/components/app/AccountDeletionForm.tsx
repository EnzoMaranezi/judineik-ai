import { useEffect, useState } from "react";
import { AlertCircle } from "lucide-react";
import { PrimaryButton } from "@/components/app/ui";
import {
  ACCOUNT_DELETION_INVALID_PASSWORD,
  ACCOUNT_DELETION_SESSION_INVALID,
  ACCOUNT_DELETION_UNAVAILABLE,
  ACCOUNT_REAUTHENTICATION_REQUIRED,
  AccountDeletionClientError,
  isCurrentAccountActive,
  reauthenticateForAccountDeletion,
  requestAccountDeletion,
} from "@/lib/account-deletion-client";
import { useI18n } from "@/lib/i18n";

type DeletionPhase = "idle" | "reauthenticating" | "deleting" | "pending";

function messageKey(error: unknown): string {
  if (!(error instanceof AccountDeletionClientError)) return "settings.deleteAccountError";
  if (error.code === ACCOUNT_DELETION_INVALID_PASSWORD) return "settings.deleteAccountWrongPassword";
  if (error.code === ACCOUNT_DELETION_SESSION_INVALID) return "settings.deleteAccountSessionInvalid";
  if (error.code === ACCOUNT_REAUTHENTICATION_REQUIRED) return "settings.deleteAccountReauthenticationRequired";
  if (error.code === ACCOUNT_DELETION_UNAVAILABLE) return "settings.deleteAccountError";
  return "settings.deleteAccountError";
}

export function AccountDeletionForm({
  email,
  userId,
  pending = false,
  onDeleted,
  onLockedChange,
}: {
  email: string;
  userId: string;
  pending?: boolean;
  onDeleted: () => Promise<void>;
  onLockedChange?: (locked: boolean) => void;
}) {
  const { t } = useI18n();
  const [password, setPassword] = useState("");
  const [phase, setPhase] = useState<DeletionPhase>(pending ? "pending" : "idle");
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const busy = phase === "reauthenticating" || phase === "deleting";
  const locked = busy || phase === "pending";

  useEffect(() => {
    onLockedChange?.(locked);
  }, [locked, onLockedChange]);

  async function submit() {
    if (!password) {
      setErrorKey("settings.deleteAccountPasswordRequired");
      return;
    }

    setErrorKey(null);
    setPhase("reauthenticating");
    try {
      const accessToken = await reauthenticateForAccountDeletion(email, password);
      setPhase("deleting");
      await requestAccountDeletion(accessToken);
      await onDeleted();
    } catch (error) {
      const active = await isCurrentAccountActive(userId).catch(() => true);
      if (!active) setPhase("pending");
      else setPhase("idle");
      setErrorKey(messageKey(error));
    }
  }

  return (
    <div className="mt-5 grid gap-3">
      <label htmlFor="account-deletion-password" className="label-mono">
        {t("settings.deleteAccountPassword")}
      </label>
      <input
        id="account-deletion-password"
        type="password"
        autoComplete="current-password"
        autoFocus
        value={password}
        disabled={busy}
        onChange={(event) => setPassword(event.target.value)}
        placeholder={t("settings.deleteAccountPasswordPlaceholder")}
        className="rounded-xl border border-border bg-surface-2/60 px-4 py-3 text-sm outline-none placeholder:text-muted-foreground focus:border-destructive/60"
      />
      {phase === "pending" ? (
        <p className="text-sm leading-relaxed text-muted-foreground">{t("settings.deleteAccountPending")}</p>
      ) : null}
      {errorKey ? (
        <p role="alert" className="flex items-center gap-2 text-sm text-destructive">
          <AlertCircle className="size-4" aria-hidden />
          {t(errorKey)}
        </p>
      ) : null}
      <PrimaryButton
        className="mt-1 bg-destructive text-destructive-foreground hover:shadow-none"
        onClick={() => void submit()}
        disabled={busy || !password}
      >
        {phase === "reauthenticating"
          ? t("settings.deleteAccountReauthenticating")
          : phase === "deleting"
            ? t("settings.deleteAccountDeleting")
            : phase === "pending"
              ? t("settings.deleteAccountRetry")
              : t("settings.deleteAccountConfirm")}
      </PrimaryButton>
    </div>
  );
}
