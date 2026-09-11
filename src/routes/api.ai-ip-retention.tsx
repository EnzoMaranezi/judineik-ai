import { createFileRoute } from "@tanstack/react-router";
import { handleAiIpRetentionCron } from "@/lib/ai-ip-retention.server";

export const Route = createFileRoute("/api/ai-ip-retention")({
  server: {
    handlers: {
      GET: ({ request }) => handleAiIpRetentionCron(request),
    },
  },
});
