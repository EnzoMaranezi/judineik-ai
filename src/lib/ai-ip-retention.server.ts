import { timingSafeEqual } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

const RETENTION_CONFIGURATION_UNAVAILABLE = "AI_RETENTION_CONFIGURATION_UNAVAILABLE";

type RetentionEnvironment = {
  AI_RETENTION_CRON_SECRET?: string;
  CRON_SECRET?: string;
  SUPABASE_URL?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
};

type RetentionDependencies = {
  env?: RetentionEnvironment;
  cleanup?: () => Promise<void>;
  logError?: (message: string) => void;
};

function isStrongSecret(value: string | undefined): value is string {
  return typeof value === "string" && Buffer.byteLength(value, "utf8") >= 32;
}

function constantTimeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, "utf8");
  const rightBuffer = Buffer.from(right, "utf8");
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function retentionCronSecret(env: RetentionEnvironment): string {
  const retentionSecret = env.AI_RETENTION_CRON_SECRET;
  const vercelSecret = env.CRON_SECRET;

  if (!isStrongSecret(retentionSecret)) {
    throw new Error(RETENTION_CONFIGURATION_UNAVAILABLE);
  }

  if (!isStrongSecret(vercelSecret)) throw new Error(RETENTION_CONFIGURATION_UNAVAILABLE);

  if (!constantTimeEqual(retentionSecret, vercelSecret)) {
    throw new Error(RETENTION_CONFIGURATION_UNAVAILABLE);
  }

  return retentionSecret;
}

export function isAuthorizedAiIpRetentionCron(request: Request, secret: string): boolean {
  const authorization = request.headers.get("authorization");
  const previewAuthorization = request.headers.get("x-ai-retention-cron-secret");
  const expected = `Bearer ${secret}`;
  return (
    (authorization !== null && constantTimeEqual(authorization, expected)) ||
    (previewAuthorization !== null && constantTimeEqual(previewAuthorization, secret))
  );
}

async function cleanupAiIpGenerationEvents(env: RetentionEnvironment): Promise<void> {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error(RETENTION_CONFIGURATION_UNAVAILABLE);
  }

  const supabase = createClient<Database>(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { error } = await supabase.rpc("cleanup_ai_ip_generation_events");
  if (error) throw new Error("AI_IP_RETENTION_CLEANUP_FAILED");
}

export async function handleAiIpRetentionCron(
  request: Request,
  dependencies: RetentionDependencies = {},
): Promise<Response> {
  const env = dependencies.env ?? process.env;
  const logError = dependencies.logError ?? console.error;

  let secret: string;
  try {
    secret = retentionCronSecret(env);
  } catch {
    logError("[AI IP retention] Cron configuration is unavailable.");
    return Response.json({ ok: false }, { status: 503 });
  }

  if (!isAuthorizedAiIpRetentionCron(request, secret)) {
    return Response.json({ ok: false }, { status: 401 });
  }

  try {
    await (dependencies.cleanup ?? (() => cleanupAiIpGenerationEvents(env)))();
    return Response.json({ ok: true });
  } catch {
    logError("[AI IP retention] Cleanup failed.");
    return Response.json({ ok: false }, { status: 500 });
  }
}
