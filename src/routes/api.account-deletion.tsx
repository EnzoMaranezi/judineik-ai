import { createFileRoute } from "@tanstack/react-router";
import {
  ACCOUNT_REAUTHENTICATION_REQUIRED,
  ACCOUNT_DELETION_UNAVAILABLE,
} from "@/lib/account-deletion";
import { deleteCurrentAccount } from "@/lib/account-deletion.server";

export const Route = createFileRoute("/api/account-deletion")({
  server: {
    handlers: {
      POST: async () => {
        try {
          await deleteCurrentAccount();
          return Response.json({ deleted: true });
        } catch (error) {
          const code = error instanceof Error && error.message.includes(ACCOUNT_REAUTHENTICATION_REQUIRED)
            ? ACCOUNT_REAUTHENTICATION_REQUIRED
            : ACCOUNT_DELETION_UNAVAILABLE;
          return Response.json({ deleted: false, code }, { status: code === ACCOUNT_REAUTHENTICATION_REQUIRED ? 403 : 503 });
        }
      },
    },
  },
});
