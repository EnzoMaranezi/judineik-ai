import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  ACCOUNT_DELETION_UNAVAILABLE,
  ACCOUNT_REAUTHENTICATION_REQUIRED,
  assertTrustedAccountDeletionRequest,
  executeAccountDeletion,
  type AccountDeletionDependencies,
  type DeletionStatus,
} from "@/lib/account-deletion";

function isMissingAuthUser(error: {
  code?: string | undefined;
  status?: number | undefined;
  message?: string | undefined;
}): boolean {
  return error.code === "user_not_found"
    || error.status === 404
    || error.message?.toLowerCase().includes("user not found") === true;
}

function createProductionDependencies(
  userId: string,
  userClient: ReturnType<typeof createClient<Database>>,
): AccountDeletionDependencies {
  const supabaseUrl = process.env["SUPABASE_URL"];
  const serviceRoleKey = process.env["SUPABASE_SERVICE_ROLE_KEY"];
  if (!supabaseUrl || !serviceRoleKey) throw new Error(ACCOUNT_DELETION_UNAVAILABLE);

  const admin = createClient<Database>(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const bucket = admin.storage.from("documents");

  return {
    begin: async () => {
      const { data, error } = await userClient.rpc("begin_account_deletion");
      if (error) {
        if (error.message.includes(ACCOUNT_REAUTHENTICATION_REQUIRED)) {
          throw new Error(ACCOUNT_REAUTHENTICATION_REQUIRED);
        }
        throw new Error(ACCOUNT_DELETION_UNAVAILABLE);
      }
      return data as DeletionStatus;
    },
    storage: {
      list: async (prefix, options) => {
        const { data, error } = await bucket.list(prefix, {
          limit: options.limit,
          offset: options.offset,
          sortBy: { column: "name", order: "asc" },
        });
        if (error) throw new Error(ACCOUNT_DELETION_UNAVAILABLE);
        return (data ?? []).map((entry) => ({ id: entry.id, name: entry.name }));
      },
      remove: async (paths) => {
        const { error } = await bucket.remove(paths);
        if (error) throw new Error(ACCOUNT_DELETION_UNAVAILABLE);
      },
    },
    updateStatus: async (status) => {
      let statusUpdate = admin
        .from("account_deletion_requests")
        .update({ status, updated_at: new Date().toISOString() })
        .eq("user_id", userId);

      // Concurrent workers may repeat stages, but must never move auth_deleting backwards.
      if (status === "storage_cleared") {
        statusUpdate = statusUpdate.in("status", ["pending", "storage_cleared"]);
      }

      const { error } = await statusUpdate;
      if (error) throw new Error(ACCOUNT_DELETION_UNAVAILABLE);
    },
    deleteAuthUser: async () => {
      const { error } = await admin.auth.admin.deleteUser(userId, false);
      if (!error) return "deleted";
      if (isMissingAuthUser(error)) return "already_missing";
      throw new Error(ACCOUNT_DELETION_UNAVAILABLE);
    },
  };
}

export const deleteCurrentAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    assertTrustedAccountDeletionRequest(getRequest());

    try {
      return await executeAccountDeletion(
        context.userId,
        createProductionDependencies(context.userId, context.supabase),
      );
    } catch (error) {
      if (error instanceof Error && error.message === ACCOUNT_REAUTHENTICATION_REQUIRED) throw error;
      console.error("[Account deletion] Account deletion could not be completed.");
      throw new Error(ACCOUNT_DELETION_UNAVAILABLE);
    }
  });
