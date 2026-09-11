ALTER TABLE public.documents
  ADD CONSTRAINT documents_user_id_fkey
  FOREIGN KEY (user_id)
  REFERENCES auth.users(id)
  ON DELETE CASCADE;

CREATE TABLE public.account_deletion_requests (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  status text NOT NULL CHECK (status IN ('pending', 'storage_cleared', 'auth_deleting')),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.account_deletion_requests ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.account_deletion_requests FROM PUBLIC;
REVOKE ALL ON TABLE public.account_deletion_requests FROM anon;
REVOKE ALL ON TABLE public.account_deletion_requests FROM authenticated;
REVOKE ALL ON TABLE public.account_deletion_requests FROM service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.account_deletion_requests TO service_role;

CREATE FUNCTION public.is_account_active(p_user_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF p_user_id IS NULL
    OR auth.uid() IS NULL
    OR p_user_id IS DISTINCT FROM auth.uid() THEN
    RETURN false;
  END IF;

  RETURN EXISTS (
    SELECT 1
    FROM auth.users AS account_user
    WHERE account_user.id = p_user_id
  ) AND NOT EXISTS (
    SELECT 1
    FROM public.account_deletion_requests AS deletion_request
    WHERE deletion_request.user_id = p_user_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.is_account_active(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_account_active(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.is_account_active(uuid) FROM service_role;
GRANT EXECUTE ON FUNCTION public.is_account_active(uuid) TO authenticated;

CREATE FUNCTION public.begin_account_deletion()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_session_id_text text := auth.jwt()->>'session_id';
  v_session_id uuid;
  v_session_created_at timestamp with time zone;
  v_now timestamp with time zone := clock_timestamp();
  v_status text;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED' USING ERRCODE = '28000';
  END IF;

  IF v_session_id_text IS NULL
    OR v_session_id_text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN
    RAISE EXCEPTION 'ACCOUNT_REAUTHENTICATION_REQUIRED' USING ERRCODE = 'P0001';
  END IF;
  v_session_id := v_session_id_text::uuid;

  SELECT auth_session.created_at
  INTO v_session_created_at
  FROM auth.sessions AS auth_session
  WHERE auth_session.id = v_session_id
    AND auth_session.user_id = v_user_id;

  IF NOT FOUND
    OR v_session_created_at < v_now - interval '10 minutes'
    OR v_session_created_at > v_now + interval '30 seconds' THEN
    RAISE EXCEPTION 'ACCOUNT_REAUTHENTICATION_REQUIRED' USING ERRCODE = 'P0001';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtext('account-deletion'),
    hashtext(v_user_id::text)
  );

  INSERT INTO public.account_deletion_requests AS deletion_request (
    user_id,
    status
  )
  VALUES (v_user_id, 'pending')
  ON CONFLICT (user_id) DO UPDATE
  SET updated_at = clock_timestamp()
  RETURNING deletion_request.status INTO v_status;

  RETURN v_status;
END;
$$;

REVOKE ALL ON FUNCTION public.begin_account_deletion() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.begin_account_deletion() FROM anon;
REVOKE ALL ON FUNCTION public.begin_account_deletion() FROM service_role;
GRANT EXECUTE ON FUNCTION public.begin_account_deletion() TO authenticated;

-- Existing permissive ownership policies remain authoritative for row ownership.
-- These restrictive policies additionally close access as soon as deletion starts.
CREATE POLICY "Account must be active for documents"
ON public.documents AS RESTRICTIVE FOR ALL TO authenticated
USING (public.is_account_active(auth.uid()))
WITH CHECK (public.is_account_active(auth.uid()));

CREATE POLICY "Account must be active for summaries"
ON public.summaries AS RESTRICTIVE FOR ALL TO authenticated
USING (public.is_account_active(auth.uid()))
WITH CHECK (public.is_account_active(auth.uid()));

CREATE POLICY "Account must be active for question sets"
ON public.question_sets AS RESTRICTIVE FOR ALL TO authenticated
USING (public.is_account_active(auth.uid()))
WITH CHECK (public.is_account_active(auth.uid()));

CREATE POLICY "Account must be active for question sessions"
ON public.question_sessions AS RESTRICTIVE FOR ALL TO authenticated
USING (public.is_account_active(auth.uid()))
WITH CHECK (public.is_account_active(auth.uid()));

CREATE POLICY "Account must be active for document topics"
ON public.document_topics AS RESTRICTIVE FOR ALL TO authenticated
USING (public.is_account_active(auth.uid()))
WITH CHECK (public.is_account_active(auth.uid()));

CREATE POLICY "Account must be active for flashcard sets"
ON public.flashcard_sets AS RESTRICTIVE FOR ALL TO authenticated
USING (public.is_account_active(auth.uid()))
WITH CHECK (public.is_account_active(auth.uid()));

CREATE POLICY "Account must be active for flashcards"
ON public.flashcards AS RESTRICTIVE FOR ALL TO authenticated
USING (public.is_account_active(auth.uid()))
WITH CHECK (public.is_account_active(auth.uid()));

CREATE POLICY "Account must be active for flashcard reviews"
ON public.flashcard_reviews AS RESTRICTIVE FOR ALL TO authenticated
USING (public.is_account_active(auth.uid()))
WITH CHECK (public.is_account_active(auth.uid()));

CREATE POLICY "Account must be active for documents storage"
ON storage.objects AS RESTRICTIVE FOR ALL TO authenticated
USING (
  bucket_id <> 'documents'
  OR public.is_account_active(auth.uid())
)
WITH CHECK (
  bucket_id <> 'documents'
  OR public.is_account_active(auth.uid())
);

CREATE FUNCTION public.enforce_account_active_mutation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  -- Administrative cascades and the server-only deletion worker do not carry a user JWT.
  IF auth.uid() IS NOT NULL AND NOT public.is_account_active(auth.uid()) THEN
    RAISE EXCEPTION 'ACCOUNT_DELETION_IN_PROGRESS' USING ERRCODE = 'P0001';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.enforce_account_active_mutation() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.enforce_account_active_mutation() FROM anon;
REVOKE ALL ON FUNCTION public.enforce_account_active_mutation() FROM authenticated;
REVOKE ALL ON FUNCTION public.enforce_account_active_mutation() FROM service_role;

CREATE TRIGGER enforce_documents_account_active
BEFORE INSERT OR UPDATE OR DELETE ON public.documents
FOR EACH ROW EXECUTE FUNCTION public.enforce_account_active_mutation();

CREATE TRIGGER enforce_summaries_account_active
BEFORE INSERT OR UPDATE OR DELETE ON public.summaries
FOR EACH ROW EXECUTE FUNCTION public.enforce_account_active_mutation();

CREATE TRIGGER enforce_question_sets_account_active
BEFORE INSERT OR UPDATE OR DELETE ON public.question_sets
FOR EACH ROW EXECUTE FUNCTION public.enforce_account_active_mutation();

CREATE TRIGGER enforce_question_sessions_account_active
BEFORE INSERT OR UPDATE OR DELETE ON public.question_sessions
FOR EACH ROW EXECUTE FUNCTION public.enforce_account_active_mutation();

CREATE TRIGGER enforce_document_topics_account_active
BEFORE INSERT OR UPDATE OR DELETE ON public.document_topics
FOR EACH ROW EXECUTE FUNCTION public.enforce_account_active_mutation();

CREATE TRIGGER enforce_flashcard_sets_account_active
BEFORE INSERT OR UPDATE OR DELETE ON public.flashcard_sets
FOR EACH ROW EXECUTE FUNCTION public.enforce_account_active_mutation();

CREATE TRIGGER enforce_flashcards_account_active
BEFORE INSERT OR UPDATE OR DELETE ON public.flashcards
FOR EACH ROW EXECUTE FUNCTION public.enforce_account_active_mutation();

CREATE TRIGGER enforce_flashcard_reviews_account_active
BEFORE INSERT OR UPDATE OR DELETE ON public.flashcard_reviews
FOR EACH ROW EXECUTE FUNCTION public.enforce_account_active_mutation();

-- New reservations are blocked after pending; finalization updates remain available.
CREATE TRIGGER enforce_ai_reservation_account_active
BEFORE INSERT ON public.ai_generation_events
FOR EACH ROW EXECUTE FUNCTION public.enforce_account_active_mutation();

CREATE FUNCTION public.prevent_pending_account_profile_mutation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.account_deletion_requests AS deletion_request
    WHERE deletion_request.user_id = OLD.id
  ) AND (
    NEW.email IS DISTINCT FROM OLD.email
    OR NEW.phone IS DISTINCT FROM OLD.phone
    OR NEW.encrypted_password IS DISTINCT FROM OLD.encrypted_password
    OR NEW.raw_user_meta_data IS DISTINCT FROM OLD.raw_user_meta_data
    OR NEW.email_change IS DISTINCT FROM OLD.email_change
    OR NEW.phone_change IS DISTINCT FROM OLD.phone_change
  ) THEN
    RAISE EXCEPTION 'ACCOUNT_DELETION_IN_PROGRESS' USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.prevent_pending_account_profile_mutation() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.prevent_pending_account_profile_mutation() FROM anon;
REVOKE ALL ON FUNCTION public.prevent_pending_account_profile_mutation() FROM authenticated;
REVOKE ALL ON FUNCTION public.prevent_pending_account_profile_mutation() FROM service_role;

CREATE TRIGGER prevent_pending_account_profile_mutation
BEFORE UPDATE ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.prevent_pending_account_profile_mutation();
