-- Run manually only after 0011 is applied and pg_cron is enabled in the target project.
-- The job runs as the database owner; application roles cannot execute the cleanup function.
SELECT cron.schedule(
  'nexa-ai-ip-quota-retention',
  '17 3 * * *',
  'SELECT public.cleanup_ai_ip_generation_events();'
)
WHERE NOT EXISTS (
  SELECT 1
  FROM cron.job AS scheduled_job
  WHERE scheduled_job.jobname = 'nexa-ai-ip-quota-retention'
);
