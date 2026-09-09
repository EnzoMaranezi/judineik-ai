ALTER TABLE public.ai_generation_events
  ADD COLUMN action_id uuid;

CREATE UNIQUE INDEX ai_generation_events_user_action_uidx
ON public.ai_generation_events(user_id, action_id)
WHERE action_id IS NOT NULL;

CREATE TABLE public.ai_ip_generation_events (
  reservation_id uuid PRIMARY KEY,
  usage_date date NOT NULL,
  ip_digest bytea NOT NULL CHECK (octet_length(ip_digest) = 32),
  key_version integer NOT NULL CHECK (key_version > 0),
  status text NOT NULL CHECK (status IN ('reserved', 'succeeded', 'failed')),
  reserved_until timestamp with time zone NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  completed_at timestamp with time zone,
  CONSTRAINT ai_ip_generation_events_completion_check CHECK (
    (status = 'reserved' AND completed_at IS NULL)
    OR (status IN ('succeeded', 'failed') AND completed_at IS NOT NULL)
  )
);

CREATE INDEX ai_ip_generation_events_day_count_idx
ON public.ai_ip_generation_events(usage_date, key_version, ip_digest, status, reserved_until);

CREATE INDEX ai_ip_generation_events_retention_idx
ON public.ai_ip_generation_events(created_at);

ALTER TABLE public.ai_ip_generation_events ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.ai_ip_generation_events FROM PUBLIC;
REVOKE ALL ON TABLE public.ai_ip_generation_events FROM anon;
REVOKE ALL ON TABLE public.ai_ip_generation_events FROM authenticated;
REVOKE ALL ON TABLE public.ai_ip_generation_events FROM service_role;

DROP FUNCTION IF EXISTS public.reserve_ai_generation(text, uuid, text, uuid);
DROP FUNCTION IF EXISTS public.finish_ai_generation(uuid, text);

CREATE FUNCTION public.reserve_ai_generation(
  p_kind text,
  p_document_id uuid,
  p_locale text,
  p_topic_id uuid,
  p_action_id uuid,
  p_ip_digest text,
  p_key_version integer,
  p_issued_at bigint,
  p_authorization text
)
RETURNS TABLE(reservation_id uuid, used_count integer, limit_count integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_now timestamp with time zone := transaction_timestamp();
  v_now_epoch bigint := extract(epoch FROM transaction_timestamp())::bigint;
  v_usage_date date := ((transaction_timestamp() AT TIME ZONE 'UTC')::date);
  v_account_limit integer := 20;
  v_ip_limit integer := 100;
  v_account_used integer;
  v_ip_used integer;
  v_reservation_id uuid;
  v_existing public.ai_generation_events%ROWTYPE;
  v_existing_ip public.ai_ip_generation_events%ROWTYPE;
  v_source_text text;
  v_topic_source_hash text;
  v_computed_hash text;
  v_ip_digest bytea;
  v_signing_secret text;
  v_payload text;
  v_expected_authorization bytea;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED' USING ERRCODE = '28000';
  END IF;
  IF p_action_id IS NULL THEN
    RAISE EXCEPTION 'INVALID_AI_QUOTA_AUTHORIZATION' USING ERRCODE = '22023';
  END IF;
  IF p_kind NOT IN ('summary', 'questions', 'practice_questions', 'flashcards', 'topic_discovery') THEN
    RAISE EXCEPTION 'UNSUPPORTED_AI_GENERATION_KIND' USING ERRCODE = '22023';
  END IF;
  IF p_kind = 'topic_discovery' THEN
    IF p_locale <> 'und' OR p_topic_id IS NOT NULL THEN
      RAISE EXCEPTION 'UNSUPPORTED_CONTENT_LOCALE' USING ERRCODE = '22023';
    END IF;
  ELSIF p_locale NOT IN ('en', 'pt-BR') THEN
    RAISE EXCEPTION 'UNSUPPORTED_CONTENT_LOCALE' USING ERRCODE = '22023';
  END IF;
  IF p_topic_id IS NOT NULL
    AND p_kind NOT IN ('summary', 'questions', 'practice_questions', 'flashcards') THEN
    RAISE EXCEPTION 'UNSUPPORTED_AI_TOPIC_SCOPE' USING ERRCODE = '22023';
  END IF;
  IF p_key_version <> 1
    OR p_ip_digest IS NULL
    OR p_ip_digest !~ '^[0-9a-f]{64}$'
    OR p_authorization IS NULL
    OR p_authorization !~ '^[0-9a-f]{64}$'
    OR p_issued_at < v_now_epoch - 300
    OR p_issued_at > v_now_epoch + 30 THEN
    RAISE EXCEPTION 'INVALID_AI_QUOTA_AUTHORIZATION' USING ERRCODE = '22023';
  END IF;

  SELECT decrypted_secret
  INTO v_signing_secret
  FROM vault.decrypted_secrets
  WHERE name = 'AI_QUOTA_RPC_SIGNING_SECRET'
  ORDER BY created_at DESC
  LIMIT 1;

  IF v_signing_secret IS NULL OR octet_length(convert_to(v_signing_secret, 'UTF8')) < 32 THEN
    RAISE EXCEPTION 'AI_QUOTA_CONFIGURATION_UNAVAILABLE' USING ERRCODE = 'P0001';
  END IF;

  v_payload := array_to_string(
    ARRAY[
      'reserve',
      p_key_version::text,
      v_user_id::text,
      p_kind,
      p_document_id::text,
      COALESCE(p_topic_id::text, '-'),
      p_locale,
      p_action_id::text,
      p_ip_digest,
      p_issued_at::text
    ],
    chr(10)
  );
  v_expected_authorization := extensions.hmac(
    convert_to(v_payload, 'UTF8'),
    convert_to(v_signing_secret, 'UTF8'),
    'sha256'
  );
  IF decode(p_authorization, 'hex') <> v_expected_authorization THEN
    RAISE EXCEPTION 'INVALID_AI_QUOTA_AUTHORIZATION' USING ERRCODE = '22023';
  END IF;
  v_ip_digest := decode(p_ip_digest, 'hex');

  SELECT extracted_text
  INTO v_source_text
  FROM public.documents
  WHERE id = p_document_id
    AND user_id = v_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'DOCUMENT_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;

  IF p_topic_id IS NOT NULL THEN
    SELECT source_hash
    INTO v_topic_source_hash
    FROM public.document_topics
    WHERE id = p_topic_id
      AND document_id = p_document_id
      AND user_id = v_user_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'TOPIC_NOT_FOUND' USING ERRCODE = 'P0001';
    END IF;
    IF v_source_text IS NULL OR btrim(v_source_text) = '' THEN
      RAISE EXCEPTION 'TOPIC_SOURCE_UNAVAILABLE' USING ERRCODE = 'P0001';
    END IF;

    v_computed_hash := encode(
      extensions.digest(convert_to(v_source_text, 'UTF8'), 'sha256'),
      'hex'
    );
    IF v_computed_hash <> v_topic_source_hash THEN
      RAISE EXCEPTION 'STALE_TOPIC_SOURCE' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  -- A dedicated bigint lock namespace serializes each IP/day before account and scope locks.
  PERFORM pg_advisory_xact_lock(
    hashtextextended(
      'ai-ip:' || p_key_version::text || ':' || p_ip_digest || ':' || v_usage_date::text,
      0
    )
  );
  PERFORM pg_advisory_xact_lock(hashtext(v_user_id::text), hashtext(v_usage_date::text));
  PERFORM pg_advisory_xact_lock(
    hashtext(v_user_id::text),
    hashtext(
      p_document_id::text
      || ':'
      || COALESCE(p_topic_id::text, 'document')
      || ':'
      || p_kind
      || ':'
      || p_locale
    )
  );

  -- A replay caused by a lost RPC response returns the original active reservation.
  SELECT *
  INTO v_existing
  FROM public.ai_generation_events
  WHERE user_id = v_user_id
    AND action_id = p_action_id
  FOR UPDATE;

  IF FOUND THEN
    SELECT *
    INTO v_existing_ip
    FROM public.ai_ip_generation_events
    WHERE reservation_id = v_existing.id
    FOR UPDATE;

    IF NOT FOUND
      OR v_existing.document_id IS DISTINCT FROM p_document_id
      OR v_existing.topic_scope_id IS DISTINCT FROM p_topic_id
      OR v_existing.kind <> p_kind
      OR v_existing.locale <> p_locale
      OR v_existing.status <> 'reserved'
      OR v_existing.reserved_until <= v_now
      OR v_existing_ip.usage_date <> v_existing.usage_date
      OR v_existing_ip.key_version <> p_key_version
      OR v_existing_ip.ip_digest <> v_ip_digest
      OR v_existing_ip.status <> 'reserved'
      OR v_existing_ip.reserved_until <= v_now THEN
      RAISE EXCEPTION 'AI_GENERATION_ACTION_REPLAY_REJECTED' USING ERRCODE = 'P0001';
    END IF;

    SELECT count(*)::integer
    INTO v_account_used
    FROM public.ai_generation_events
    WHERE user_id = v_user_id
      AND usage_date = v_usage_date
      AND (
        status = 'succeeded'
        OR (status = 'reserved' AND reserved_until > v_now)
      );
    RETURN QUERY SELECT v_existing.id, v_account_used, v_account_limit;
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.ai_generation_events
    WHERE user_id = v_user_id
      AND document_id = p_document_id
      AND topic_scope_id IS NOT DISTINCT FROM p_topic_id
      AND kind = p_kind
      AND locale = p_locale
      AND status = 'reserved'
      AND reserved_until > v_now
  ) THEN
    RAISE EXCEPTION 'AI_GENERATION_IN_PROGRESS' USING ERRCODE = 'P0001';
  END IF;

  SELECT count(*)::integer
  INTO v_account_used
  FROM public.ai_generation_events
  WHERE user_id = v_user_id
    AND usage_date = v_usage_date
    AND (
      status = 'succeeded'
      OR (status = 'reserved' AND reserved_until > v_now)
    );

  IF v_account_used >= v_account_limit THEN
    RAISE EXCEPTION 'AI_DAILY_LIMIT_REACHED' USING ERRCODE = 'P0001';
  END IF;

  SELECT count(*)::integer
  INTO v_ip_used
  FROM public.ai_ip_generation_events
  WHERE usage_date = v_usage_date
    AND key_version = p_key_version
    AND ip_digest = v_ip_digest
    AND (
      status = 'succeeded'
      OR (status = 'reserved' AND reserved_until > v_now)
    );

  IF v_ip_used >= v_ip_limit THEN
    RAISE EXCEPTION 'AI_NETWORK_LIMIT_REACHED' USING ERRCODE = 'P0001';
  END IF;

  v_reservation_id := gen_random_uuid();
  INSERT INTO public.ai_generation_events (
    id,
    user_id,
    usage_date,
    kind,
    document_id,
    topic_id,
    topic_scope_id,
    locale,
    status,
    reserved_until,
    action_id
  )
  VALUES (
    v_reservation_id,
    v_user_id,
    v_usage_date,
    p_kind,
    p_document_id,
    p_topic_id,
    p_topic_id,
    p_locale,
    'reserved',
    v_now + interval '30 minutes',
    p_action_id
  );

  INSERT INTO public.ai_ip_generation_events (
    reservation_id,
    usage_date,
    ip_digest,
    key_version,
    status,
    reserved_until
  )
  VALUES (
    v_reservation_id,
    v_usage_date,
    v_ip_digest,
    p_key_version,
    'reserved',
    v_now + interval '30 minutes'
  );

  -- Retain only the last seven rolling days and never delete current-day usage.
  DELETE FROM public.ai_ip_generation_events
  WHERE created_at < v_now - interval '7 days'
    AND usage_date < v_usage_date;

  RETURN QUERY SELECT v_reservation_id, v_account_used + 1, v_account_limit;
END;
$$;

CREATE FUNCTION public.finish_ai_generation(
  p_reservation_id uuid,
  p_status text,
  p_ip_digest text,
  p_key_version integer,
  p_issued_at bigint,
  p_authorization text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_now timestamp with time zone := transaction_timestamp();
  v_now_epoch bigint := extract(epoch FROM transaction_timestamp())::bigint;
  v_signing_secret text;
  v_payload text;
  v_expected_authorization bytea;
  v_account_status text;
  v_ip_status text;
  v_stored_ip_digest bytea;
  v_stored_key_version integer;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED' USING ERRCODE = '28000';
  END IF;
  IF p_status NOT IN ('succeeded', 'failed') THEN
    RAISE EXCEPTION 'UNSUPPORTED_AI_GENERATION_STATUS' USING ERRCODE = '22023';
  END IF;
  IF p_key_version <> 1
    OR p_ip_digest IS NULL
    OR p_ip_digest !~ '^[0-9a-f]{64}$'
    OR p_authorization IS NULL
    OR p_authorization !~ '^[0-9a-f]{64}$'
    OR p_issued_at < v_now_epoch - 300
    OR p_issued_at > v_now_epoch + 30 THEN
    RAISE EXCEPTION 'INVALID_AI_QUOTA_AUTHORIZATION' USING ERRCODE = '22023';
  END IF;

  SELECT decrypted_secret
  INTO v_signing_secret
  FROM vault.decrypted_secrets
  WHERE name = 'AI_QUOTA_RPC_SIGNING_SECRET'
  ORDER BY created_at DESC
  LIMIT 1;

  IF v_signing_secret IS NULL OR octet_length(convert_to(v_signing_secret, 'UTF8')) < 32 THEN
    RAISE EXCEPTION 'AI_QUOTA_CONFIGURATION_UNAVAILABLE' USING ERRCODE = 'P0001';
  END IF;

  v_payload := array_to_string(
    ARRAY[
      'finish',
      p_key_version::text,
      v_user_id::text,
      p_reservation_id::text,
      p_status,
      p_ip_digest,
      p_issued_at::text
    ],
    chr(10)
  );
  v_expected_authorization := extensions.hmac(
    convert_to(v_payload, 'UTF8'),
    convert_to(v_signing_secret, 'UTF8'),
    'sha256'
  );
  IF decode(p_authorization, 'hex') <> v_expected_authorization THEN
    RAISE EXCEPTION 'INVALID_AI_QUOTA_AUTHORIZATION' USING ERRCODE = '22023';
  END IF;

  SELECT account_event.status, ip_event.status, ip_event.ip_digest, ip_event.key_version
  INTO v_account_status, v_ip_status, v_stored_ip_digest, v_stored_key_version
  FROM public.ai_generation_events AS account_event
  JOIN public.ai_ip_generation_events AS ip_event
    ON ip_event.reservation_id = account_event.id
  WHERE account_event.id = p_reservation_id
    AND account_event.user_id = v_user_id
  FOR UPDATE OF account_event, ip_event;

  IF NOT FOUND
    OR v_stored_key_version <> p_key_version
    OR v_stored_ip_digest <> decode(p_ip_digest, 'hex') THEN
    RAISE EXCEPTION 'AI_GENERATION_RESERVATION_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;

  IF v_account_status = p_status AND v_ip_status = p_status THEN
    RETURN;
  END IF;
  IF v_account_status <> 'reserved' OR v_ip_status <> 'reserved' THEN
    RAISE EXCEPTION 'AI_GENERATION_FINALIZATION_CONFLICT' USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.ai_generation_events
  SET status = p_status, completed_at = v_now
  WHERE id = p_reservation_id
    AND user_id = v_user_id
    AND status = 'reserved';

  UPDATE public.ai_ip_generation_events
  SET status = p_status, completed_at = v_now
  WHERE reservation_id = p_reservation_id
    AND status = 'reserved';
END;
$$;

REVOKE ALL ON FUNCTION public.reserve_ai_generation(text, uuid, text, uuid, uuid, text, integer, bigint, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reserve_ai_generation(text, uuid, text, uuid, uuid, text, integer, bigint, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.reserve_ai_generation(text, uuid, text, uuid, uuid, text, integer, bigint, text) TO authenticated;

REVOKE ALL ON FUNCTION public.finish_ai_generation(uuid, text, text, integer, bigint, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.finish_ai_generation(uuid, text, text, integer, bigint, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.finish_ai_generation(uuid, text, text, integer, bigint, text) TO authenticated;
