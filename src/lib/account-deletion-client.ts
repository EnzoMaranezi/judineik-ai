import { supabase } from "@/lib/supabase";

export { clearNexaBrowserState } from "@/lib/account-deletion-browser-state";

export const ACCOUNT_DELETION_INVALID_PASSWORD = "ACCOUNT_DELETION_INVALID_PASSWORD";
export const ACCOUNT_DELETION_SESSION_INVALID = "ACCOUNT_DELETION_SESSION_INVALID";
export const ACCOUNT_REAUTHENTICATION_REQUIRED = "ACCOUNT_REAUTHENTICATION_REQUIRED";
export const ACCOUNT_DELETION_UNAVAILABLE = "ACCOUNT_DELETION_UNAVAILABLE";

export class AccountDeletionClientError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(code);
    this.code = code;
  }
}

export async function reauthenticateForAccountDeletion(email: string, password: string): Promise<string> {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    const message = error.message.toLowerCase();
    throw new AccountDeletionClientError(
      message.includes("invalid login credentials")
        ? ACCOUNT_DELETION_INVALID_PASSWORD
        : ACCOUNT_DELETION_SESSION_INVALID,
    );
  }

  if (!data.session?.access_token) {
    throw new AccountDeletionClientError(ACCOUNT_DELETION_SESSION_INVALID);
  }

  return data.session.access_token;
}

export async function requestAccountDeletion(accessToken: string): Promise<void> {
  let response: Response;
  try {
    response = await fetch("/api/account-deletion", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Origin: window.location.origin,
      },
    });
  } catch {
    throw new AccountDeletionClientError(ACCOUNT_DELETION_UNAVAILABLE);
  }

  const payload = await response.json().catch(() => null) as { deleted?: boolean; code?: string } | null;
  if (response.ok && payload?.deleted === true) return;

  throw new AccountDeletionClientError(
    payload?.code === ACCOUNT_REAUTHENTICATION_REQUIRED
      ? ACCOUNT_REAUTHENTICATION_REQUIRED
      : ACCOUNT_DELETION_UNAVAILABLE,
  );
}

export async function isCurrentAccountActive(userId: string): Promise<boolean> {
  const { data, error } = await supabase.rpc("is_account_active", { p_user_id: userId });
  if (error || typeof data !== "boolean") return true;
  return data;
}
