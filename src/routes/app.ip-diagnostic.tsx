import { createServerFn } from "@tanstack/react-start";
import { createFileRoute } from "@tanstack/react-router";
import { getRequestHeader } from "@tanstack/react-start/server";
import { isIP } from "node:net";
import { useEffect, useState } from "react";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

type IpDiagnostic = {
  identified: boolean;
  family: "ipv4" | "ipv6" | null;
  header: "x-vercel-forwarded-for" | null;
  normalized: boolean;
};

function inspectVercelIp(value: string | undefined): Omit<IpDiagnostic, "header"> {
  if (!value || value.includes(",")) {
    return { identified: false, family: null, normalized: false };
  }

  const candidate = value.trim().toLowerCase();
  if (!candidate) return { identified: false, family: null, normalized: false };

  const family = isIP(candidate);
  if (family === 4) return { identified: true, family: "ipv4", normalized: true };
  if (family === 6) return { identified: true, family: "ipv6", normalized: true };
  return { identified: false, family: null, normalized: false };
}

const inspectClientIp = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async (): Promise<IpDiagnostic> => {
    const value = getRequestHeader("x-vercel-forwarded-for");
    return {
      ...inspectVercelIp(value),
      header: value ? "x-vercel-forwarded-for" : null,
    };
  });

export const Route = createFileRoute("/app/ip-diagnostic")({
  component: IpDiagnosticPage,
});

function IpDiagnosticPage() {
  const [result, setResult] = useState<IpDiagnostic | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    inspectClientIp()
      .then(setResult)
      .catch(() => setFailed(true));
  }, []);

  if (failed) return <p>Diagnostic request failed.</p>;
  if (!result) return <p>Checking server-side IP metadata…</p>;

  return (
    <dl>
      <dt>Trusted IP identified</dt>
      <dd>{String(result.identified)}</dd>
      <dt>IP family</dt>
      <dd>{result.family ?? "none"}</dd>
      <dt>Header used</dt>
      <dd>{result.header ?? "none"}</dd>
      <dt>Normalization succeeded</dt>
      <dd>{String(result.normalized)}</dd>
    </dl>
  );
}
