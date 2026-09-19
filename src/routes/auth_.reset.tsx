import { useEffect, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { motion } from "motion/react";
import { Loader2 } from "lucide-react";
import { SITE } from "@/data/site";
import { setPasswordRecoveryPending } from "@/hooks/useAuth";
import { supabase } from "@/lib/supabase";
import { authErrorMessage, signOut, updatePassword } from "@/services/authService";
import { useI18n } from "@/lib/i18n";

export const Route = createFileRoute("/auth_/reset")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Reset password — Judineik AI study assistant" },
      { name: "description", content: "Set a new password for your Judineik AI account." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: ResetPasswordPage,
});

function getRecoveryError(): string | null {
  const query = new URLSearchParams(window.location.search);
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  return query.get("error_description") ?? hash.get("error_description");
}

function isRecoveryLink(): boolean {
  const query = new URLSearchParams(window.location.search);
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  return query.has("code") || query.get("type") === "recovery" || hash.get("type") === "recovery";
}

function ResetPasswordPage() {
  const navigate = useNavigate();
  const { t } = useI18n();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [checking, setChecking] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const recoveryError = getRecoveryError();
    const recoveryLink = isRecoveryLink();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY" && active) {
        setPasswordRecoveryPending(true);
        setError(null);
      }
    });

    async function prepareRecoverySession() {
      try {
        if (recoveryError) {
          throw new Error(recoveryError);
        }
        if (recoveryLink) {
          setPasswordRecoveryPending(true);
        }

        const code = new URLSearchParams(window.location.search).get("code");
        if (code) {
          const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
          if (exchangeError) throw exchangeError;
        }

        const { data } = await supabase.auth.getSession();
        if (!data.session) {
          throw new Error(t("reset.openEmailLink"));
        }
      } catch (err) {
        if (active) {
          setError(authErrorMessage(err, t, t("reset.invalidLink")));
        }
      } finally {
        if (active) setChecking(false);
      }
    }

    void prepareRecoverySession();

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);

    if (!password || !confirm) {
      setError(t("settings.passwordRequired"));
      return;
    }
    if (password.length < 6) {
      setError(t("auth.passwordMin"));
      return;
    }
    if (password !== confirm) {
      setError(t("auth.passwordMismatch"));
      return;
    }

    setBusy(true);
    try {
      await updatePassword(password);
      setPasswordRecoveryPending(false);
      await signOut();
      setPassword("");
      setConfirm("");
      setNotice(t("reset.updated"));
      window.setTimeout(() => {
        void navigate({ to: "/auth", replace: true });
      }, 1200);
    } catch (err) {
      setError(authErrorMessage(err, t, t("common.somethingWrong")));
    } finally {
      setBusy(false);
    }
  }

  async function handleBackToSignIn() {
    setPasswordRecoveryPending(false);
    await signOut();
    void navigate({ to: "/auth", replace: true });
  }

  const inputClass =
    "w-full rounded-xl border border-border bg-surface-2/60 px-4 py-3 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-lime/50";

  return (
    <main className="relative flex min-h-screen items-center justify-center bg-background px-5 py-16">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-40 [background:radial-gradient(60%_45%_at_50%_0%,color-mix(in_oklab,var(--color-lime)_12%,transparent),transparent_70%)]"
      />
      <motion.div
        initial={{ opacity: 0, y: 18 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
        className="relative w-full max-w-md rounded-2xl border border-border bg-surface/70 p-7 backdrop-blur-xl md:p-9"
      >
        <Link to="/" className="font-mono text-sm tracking-[0.2em]">
          {SITE.name}
        </Link>
        <p className="label-mono mt-6">{t("auth.passwordReset")}</p>
        <h1 className="mt-3 text-3xl tracking-tight">{t("reset.title")}</h1>
        <p className="mt-3 text-sm text-muted-foreground">
          {t("reset.description")}
        </p>

        <form onSubmit={handleSubmit} className="mt-8 flex flex-col gap-4">
          <div>
            <label htmlFor="password" className="label-mono">
              {t("reset.newPassword")}
            </label>
            <input
              id="password"
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              disabled={checking || Boolean(notice)}
              className={`${inputClass} mt-2 disabled:opacity-50`}
            />
          </div>

          <div>
            <label htmlFor="confirm" className="label-mono">
              {t("reset.confirmPassword")}
            </label>
            <input
              id="confirm"
              type="password"
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              placeholder="••••••••"
              disabled={checking || Boolean(notice)}
              className={`${inputClass} mt-2 disabled:opacity-50`}
            />
          </div>

          {error && (
            <p role="alert" className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
              {error}
            </p>
          )}
          {notice && (
            <p className="rounded-xl border border-lime/30 bg-lime/10 px-4 py-3 text-sm text-foreground">
              {notice}
            </p>
          )}

          <button
            type="submit"
            disabled={checking || busy || Boolean(notice)}
            className="mt-2 inline-flex min-h-12 items-center justify-center gap-2 rounded-full bg-lime px-6 text-sm font-medium text-background transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {(checking || busy) && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
            {checking ? t("reset.checking") : busy ? t("reset.updating") : t("reset.update")}
          </button>
        </form>

        <button
          type="button"
          onClick={() => {
            void handleBackToSignIn();
          }}
          className="mt-6 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          {t("auth.backToSignIn")}
        </button>
      </motion.div>
    </main>
  );
}
