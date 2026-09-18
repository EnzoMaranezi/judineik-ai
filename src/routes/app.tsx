import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { AppShell } from "@/components/app/AppShell";
import { AccountDeletionPending } from "@/components/app/AccountDeletionPending";
import { isPasswordRecoveryPending } from "@/hooks/useAuth";
import { supabase } from "@/lib/supabase";

export const Route = createFileRoute("/app")({
  ssr: false,
  beforeLoad: async ({ location }) => {
    if (isPasswordRecoveryPending()) {
      throw redirect({ to: "/auth/reset" });
    }

    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) {
      throw redirect({ to: "/auth", search: { redirect: location.href } });
    }
    const { data: active, error: accountStateError } = await supabase.rpc("is_account_active", {
      p_user_id: data.user.id,
    });
    return { user: data.user, accountDeletionPending: !accountStateError && active === false };
  },

  head: () => ({
    meta: [
      { title: "NEXA Workspace — Your academic agent" },
      {
        name: "description",
        content:
          "Your NEXA academic workspace: materials, summaries, questions, flashcards and learning progress.",
      },
      { property: "og:title", content: "NEXA Workspace" },
      { property: "og:description", content: "Materials, summaries, questions, flashcards and progress." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: AppLayout,
});

function AppLayout() {
  const { user, accountDeletionPending } = Route.useRouteContext();
  if (accountDeletionPending) {
    return <AccountDeletionPending email={user.email ?? ""} userId={user.id} />;
  }

  return (
    <AppShell>
      <Outlet />
    </AppShell>
  );
}
