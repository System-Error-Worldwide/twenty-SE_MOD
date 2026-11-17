BEGIN;
CREATE TABLE IF NOT EXISTS public.draft_edit_operation (
  operation_id text PRIMARY KEY,
  target_key text NOT NULL,
  expected_revision text NOT NULL,
  state text NOT NULL CHECK (state IN ('active', 'finished')),
  details jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS draft_edit_one_active_target
  ON public.draft_edit_operation (target_key) WHERE state = 'active';
DO $$
DECLARE actual text[];
BEGIN
  SELECT array_agg(column_name || ':' || udt_name || ':' || is_nullable ORDER BY ordinal_position)
    INTO actual FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'draft_edit_operation';
  IF actual IS DISTINCT FROM ARRAY['operation_id:text:NO','target_key:text:NO','expected_revision:text:NO','state:text:NO','details:jsonb:NO','updated_at:timestamptz:NO'] THEN
    RAISE EXCEPTION 'Draft edit journal columns do not match expected schema';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.draft_edit_operation'::regclass AND contype='c' AND pg_get_constraintdef(oid)=$check$CHECK ((state = ANY (ARRAY['active'::text, 'finished'::text])))$check$) THEN
    RAISE EXCEPTION 'Draft edit journal state constraint is missing or unexpected';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public' AND tablename='draft_edit_operation' AND indexname='draft_edit_operation_pkey' AND indexdef='CREATE UNIQUE INDEX draft_edit_operation_pkey ON public.draft_edit_operation USING btree (operation_id)') THEN
    RAISE EXCEPTION 'Draft edit journal primary key is missing or unexpected';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public' AND tablename='draft_edit_operation' AND indexname='draft_edit_one_active_target' AND indexdef=$idx$CREATE UNIQUE INDEX draft_edit_one_active_target ON public.draft_edit_operation USING btree (target_key) WHERE (state = 'active'::text)$idx$) THEN
    RAISE EXCEPTION 'Draft edit journal active-target index is missing or unexpected';
  END IF;
END $$;
COMMIT;
