import { useEffect, useState } from "react";
import { createFileRoute, Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { motion } from "motion/react";
import { Loader2 } from "lucide-react";
import { SITE } from "@/data/site";
import { useAuth } from "@/hooks/useAuth";
import { authErrorMessage, requestPasswordReset, signIn, signUp } from "@/services/authService";
import { useI18n } from "@/lib/i18n";

export const Route = createFileRoute("/auth")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Sign in — Judineik AI study assistant" },
      {
        name: "description",
        content: "Sign in or create your Judineik AI account to upload material and start studying.",
      },
      { property: "og:title", content: "Sign in to Judineik AI" },
      { property: "og:description", content: "Access your Judineik AI study workspace." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: AuthPage,
});

type Mode = "signin" | "signup" | "forgot";

function AuthPage() {
  const navigate = useNavigate();
  const { user, loading, passwordRecoveryPending } = useAuth();
  const { t } = useI18n();
  const search = useRouterState({ select: (s) => s.location.search }) as { redirect?: string };
  const target = typeof search?.redirect === "string" && search.redirect.startsWith("/app")
    ? search.redirect
    : "/app";

  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!loading && passwordRecoveryPending) {
      void navigate({ to: "/auth/reset", replace: true });
      return;
    }
    if (!loading && user) void navigate({ to: target, replace: true });
  }, [loading, passwordRecoveryPending, user, target, navigate]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);

    if (!email.trim() || (mode !== "forgot" && !password)) {
      setError(mode === "forgot" ? t("auth.enterEmail") : t("auth.enterEmailPassword"));
      return;
    }
    if (mode === "signup") {
      if (password.length < 6) {
        setError(t("auth.passwordMin"));
        return;
      }
      if (password !== confirm) {
        setError(t("auth.passwordMismatch"));
        return;
      }
    }

    setBusy(true);
    try {
      if (mode === "forgot") {
        await requestPasswordReset(email.trim());
        setNotice(t("auth.resetSent"));
        return;
      } else if (mode === "signup") {
        const { session } = await signUp(email.trim(), password);
        if (!session) {
          setNotice(t("auth.accountCreated"));
          setMode("signin");
          setPassword("");
          setConfirm("");
          return;
        }
      } else {
        await signIn(email.trim(), password);
      }
      void navigate({ to: target, replace: true });
    } catch (err) {
      setError(authErrorMessage(err, t, t("common.somethingWrong")));
    } finally {
      setBusy(false);
    }
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
        <p className="label-mono mt-6">
          {mode === "signin" ? t("auth.access") : mode === "signup" ? t("auth.newAccount") : t("auth.passwordReset")}
        </p>
        <h1 className="mt-3 text-3xl tracking-tight">
          {mode === "signin"
            ? t("auth.signInTitle")
            : mode === "signup"
              ? t("auth.signUpTitle")
              : t("auth.forgotTitle")}
        </h1>
        <p className="mt-3 text-sm text-muted-foreground">
          {mode === "forgot"
            ? t("auth.forgotDescription")
            : t("auth.description")}
        </p>

        <form onSubmit={handleSubmit} className="mt-8 flex flex-col gap-4">
          <div>
            <label htmlFor="email" className="label-mono">
              {t("auth.email")}
            </label>
            <input
              id="email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@university.edu"
              className={`${inputClass} mt-2`}
            />
          </div>

          {mode !== "forgot" && (
            <div>
            <label htmlFor="password" className="label-mono">
              {t("auth.password")}
            </label>
            <input
              id="password"
              type="password"
              autoComplete={mode === "signin" ? "current-password" : "new-password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              className={`${inputClass} mt-2`}
            />
            </div>
          )}

          {mode === "signup" && (
            <div>
              <label htmlFor="confirm" className="label-mono">
                {t("auth.confirmPassword")}
              </label>
              <input
                id="confirm"
                type="password"
                autoComplete="new-password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                placeholder="••••••••"
                className={`${inputClass} mt-2`}
              />
            </div>
          )}

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
            disabled={busy}
            className="mt-2 inline-flex min-h-12 items-center justify-center gap-2 rounded-full bg-lime px-6 text-sm font-medium text-background transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
            {busy
              ? mode === "signin"
                ? t("auth.signingIn")
                : mode === "signup"
                  ? t("auth.creatingAccount")
                  : t("auth.sendingResetLink")
              : mode === "signin"
                ? t("auth.signIn")
                : mode === "signup"
                  ? t("auth.createAccount")
                  : t("auth.sendResetLink")}
          </button>
        </form>

        <div className="mt-6 flex flex-col gap-3">
          {mode === "signin" && (
            <button
              type="button"
              onClick={() => {
                setMode("forgot");
                setPassword("");
                setConfirm("");
                setError(null);
                setNotice(null);
              }}
              className="text-left text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              {t("auth.forgotPassword")}
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              setMode(mode === "signin" ? "signup" : "signin");
              setError(null);
              setNotice(null);
            }}
            className="text-left text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            {mode === "signin" ? t("auth.noAccount") : t("auth.backToSignIn")}
          </button>
        </div>
      </motion.div>
    </main>
  );
}
