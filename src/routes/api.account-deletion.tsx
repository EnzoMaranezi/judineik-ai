import { createFileRoute } from "@tanstack/react-router";
import { handleAccountDeletionRequest } from "@/lib/account-deletion.server";

export const Route = createFileRoute("/api/account-deletion")({
  server: {
    handlers: {
      POST: ({ request }) => handleAccountDeletionRequest(request),
    },
  },
});
