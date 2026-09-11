-- Vercel Cron invokes the server-only retention endpoint. The endpoint uses the
-- service-role credential only to execute this fixed, input-free cleanup function.
-- It does not receive direct table access.
GRANT EXECUTE ON FUNCTION public.cleanup_ai_ip_generation_events() TO service_role;
