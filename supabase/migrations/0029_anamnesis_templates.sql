-- Migração 0029: Modelos de Anamnese e versionamento.
-- Permite que administradores definam campos dinâmicos para prontuários.

CREATE TABLE IF NOT EXISTS public.anamnesis_templates (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  title               TEXT NOT NULL CHECK (char_length(title) BETWEEN 1 AND 200),
  description         TEXT,
  version             INT NOT NULL DEFAULT 1,
  previous_version_id UUID REFERENCES public.anamnesis_templates(id) ON DELETE SET NULL,

  -- fields: Array de objetos { id, type, label, required, options[] }
  fields              JSONB NOT NULL,

  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by          UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,

  -- Um título por versão no tenant
  UNIQUE (tenant_id, title, version)
);

CREATE INDEX IF NOT EXISTS anamnesis_templates_tenant_idx ON public.anamnesis_templates (tenant_id, title);

-- Trigger para impedir modificação (append-only)
CREATE OR REPLACE FUNCTION public.enforce_anamnesis_templates_mutation()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF current_user IN ('postgres', 'supabase_admin', 'service_role') THEN RETURN NEW; END IF;
  RAISE EXCEPTION 'anamnesis_templates: records are immutable. Create a new version instead.';
END $$;

DROP TRIGGER IF EXISTS anamnesis_templates_immutable ON public.anamnesis_templates;
CREATE TRIGGER anamnesis_templates_immutable
  BEFORE UPDATE ON public.anamnesis_templates
  FOR EACH ROW EXECUTE FUNCTION public.enforce_anamnesis_templates_mutation();

DROP TRIGGER IF EXISTS anamnesis_templates_no_delete ON public.anamnesis_templates;
CREATE TRIGGER anamnesis_templates_no_delete
  BEFORE DELETE ON public.anamnesis_templates
  FOR EACH ROW EXECUTE FUNCTION public.enforce_append_only();

-- RLS
ALTER TABLE public.anamnesis_templates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS anamnesis_templates_read ON public.anamnesis_templates;
CREATE POLICY anamnesis_templates_read ON public.anamnesis_templates FOR SELECT
  USING (tenant_id = public.jwt_tenant_id());

DROP POLICY IF EXISTS anamnesis_templates_insert ON public.anamnesis_templates;
CREATE POLICY anamnesis_templates_insert ON public.anamnesis_templates FOR INSERT
  WITH CHECK (
    tenant_id = public.jwt_tenant_id() AND
    public.jwt_role() = 'admin'
  );

GRANT SELECT, INSERT ON public.anamnesis_templates TO authenticated;
REVOKE UPDATE, DELETE ON public.anamnesis_templates FROM authenticated;
