-- Migration 0103 — Tags coloridas para pacientes.
--
-- Catálogo compartilhado por tenant (cada tenant tem seu conjunto de tags
-- reutilizáveis). Atribuição many-to-many via tabela junction.
--
-- Cor: armazenada como slug curto (ex: 'red', 'sky', 'amber') que mapeia
-- para a paleta fixa do frontend. Manter como slug (não hex) garante que
-- futuras mudanças de paleta refletem em todos os badges sem migration.
--
-- Permissão: qualquer usuário autenticado do tenant pode criar/editar/
-- atribuir/remover tags (decisão do produto — clínicas pequenas precisam
-- de agilidade no dia-a-dia, não tem desk admin).
--
-- Append-only: as duas tabelas permitem UPDATE e DELETE convencional
-- (tags são objeto de configuração leve, não dado clínico/financeiro).
-- Audit cobre INSERT/UPDATE/DELETE via log_audit_event.

-- ============================================================================
-- 1) public.patient_tags — catálogo do tenant
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.patient_tags (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  name        TEXT NOT NULL CHECK (char_length(trim(name)) BETWEEN 1 AND 40),
  color       TEXT NOT NULL CHECK (color IN (
                'slate', 'red', 'orange', 'amber', 'green', 'sky', 'violet', 'pink'
              )),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by  UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Dedup case-insensitive por tenant — evita "VIP", "vip" e "V.I.P." coexistirem.
CREATE UNIQUE INDEX IF NOT EXISTS patient_tags_tenant_name_unique
  ON public.patient_tags (tenant_id, lower(name));

CREATE INDEX IF NOT EXISTS patient_tags_tenant_idx
  ON public.patient_tags (tenant_id, name);

DROP TRIGGER IF EXISTS patient_tags_touch_updated_at ON public.patient_tags;
CREATE TRIGGER patient_tags_touch_updated_at
  BEFORE UPDATE ON public.patient_tags
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Audit
CREATE OR REPLACE FUNCTION public.audit_patient_tags_change()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM public.log_audit_event(
      NEW.tenant_id, 'patient_tags', NEW.id, 'created',
      NULL, format('%s|%s', NEW.name, NEW.color), 'tag-created'
    );
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF NEW.name IS DISTINCT FROM OLD.name THEN
      PERFORM public.log_audit_event(
        NEW.tenant_id, 'patient_tags', NEW.id,
        'name', OLD.name, NEW.name, 'tag-renamed'
      );
    END IF;
    IF NEW.color IS DISTINCT FROM OLD.color THEN
      PERFORM public.log_audit_event(
        NEW.tenant_id, 'patient_tags', NEW.id,
        'color', OLD.color, NEW.color, 'tag-recolored'
      );
    END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'DELETE' THEN
    PERFORM public.log_audit_event(
      OLD.tenant_id, 'patient_tags', OLD.id, 'deleted',
      format('%s|%s', OLD.name, OLD.color), NULL, 'tag-deleted'
    );
    RETURN OLD;
  END IF;
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS patient_tags_audit ON public.patient_tags;
CREATE TRIGGER patient_tags_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.patient_tags
  FOR EACH ROW EXECUTE FUNCTION public.audit_patient_tags_change();

-- RLS
ALTER TABLE public.patient_tags ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS patient_tags_read ON public.patient_tags;
CREATE POLICY patient_tags_read ON public.patient_tags FOR SELECT
  USING (tenant_id = public.jwt_tenant_id());

DROP POLICY IF EXISTS patient_tags_insert ON public.patient_tags;
CREATE POLICY patient_tags_insert ON public.patient_tags FOR INSERT
  WITH CHECK (tenant_id = public.jwt_tenant_id());

DROP POLICY IF EXISTS patient_tags_update ON public.patient_tags;
CREATE POLICY patient_tags_update ON public.patient_tags FOR UPDATE
  USING (tenant_id = public.jwt_tenant_id())
  WITH CHECK (tenant_id = public.jwt_tenant_id());

DROP POLICY IF EXISTS patient_tags_delete ON public.patient_tags;
CREATE POLICY patient_tags_delete ON public.patient_tags FOR DELETE
  USING (tenant_id = public.jwt_tenant_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON public.patient_tags TO authenticated;

-- ============================================================================
-- 2) public.patient_tag_assignments — junction paciente↔tag
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.patient_tag_assignments (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  patient_id  UUID NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
  tag_id      UUID NOT NULL REFERENCES public.patient_tags(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by  UUID REFERENCES auth.users(id) ON DELETE SET NULL,

  CONSTRAINT patient_tag_assignments_unique UNIQUE (patient_id, tag_id)
);

CREATE INDEX IF NOT EXISTS patient_tag_assignments_patient_idx
  ON public.patient_tag_assignments (tenant_id, patient_id);

CREATE INDEX IF NOT EXISTS patient_tag_assignments_tag_idx
  ON public.patient_tag_assignments (tenant_id, tag_id);

-- Defesa: tenant_id da junction tem que bater com o tenant_id do paciente
-- E da tag. Sem isso, um INSERT malicioso (ou bug) poderia atribuir uma
-- tag do tenant A a um paciente do tenant B passando pelo RLS.
CREATE OR REPLACE FUNCTION public.enforce_patient_tag_assignment_tenant()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_patient_tenant UUID;
  v_tag_tenant     UUID;
BEGIN
  SELECT tenant_id INTO v_patient_tenant
    FROM public.patients WHERE id = NEW.patient_id;
  SELECT tenant_id INTO v_tag_tenant
    FROM public.patient_tags WHERE id = NEW.tag_id;
  IF v_patient_tenant IS NULL OR v_tag_tenant IS NULL THEN
    RAISE EXCEPTION 'patient_tag_assignment: patient/tag não encontrado';
  END IF;
  IF NEW.tenant_id <> v_patient_tenant OR NEW.tenant_id <> v_tag_tenant THEN
    RAISE EXCEPTION 'patient_tag_assignment: tenant_id divergente entre paciente, tag e assignment'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS patient_tag_assignments_tenant_check
  ON public.patient_tag_assignments;
CREATE TRIGGER patient_tag_assignments_tenant_check
  BEFORE INSERT ON public.patient_tag_assignments
  FOR EACH ROW EXECUTE FUNCTION public.enforce_patient_tag_assignment_tenant();

-- Audit (apenas INSERT/DELETE — não há UPDATE significativo)
CREATE OR REPLACE FUNCTION public.audit_patient_tag_assignment_change()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_tag_name TEXT;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT name INTO v_tag_name FROM public.patient_tags WHERE id = NEW.tag_id;
    PERFORM public.log_audit_event(
      NEW.tenant_id, 'patients', NEW.patient_id,
      'tag', NULL, COALESCE(v_tag_name, NEW.tag_id::text), 'tag-assigned'
    );
    RETURN NEW;
  END IF;
  IF TG_OP = 'DELETE' THEN
    SELECT name INTO v_tag_name FROM public.patient_tags WHERE id = OLD.tag_id;
    PERFORM public.log_audit_event(
      OLD.tenant_id, 'patients', OLD.patient_id,
      'tag', COALESCE(v_tag_name, OLD.tag_id::text), NULL, 'tag-unassigned'
    );
    RETURN OLD;
  END IF;
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS patient_tag_assignments_audit
  ON public.patient_tag_assignments;
CREATE TRIGGER patient_tag_assignments_audit
  AFTER INSERT OR DELETE ON public.patient_tag_assignments
  FOR EACH ROW EXECUTE FUNCTION public.audit_patient_tag_assignment_change();

-- RLS
ALTER TABLE public.patient_tag_assignments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS patient_tag_assignments_read ON public.patient_tag_assignments;
CREATE POLICY patient_tag_assignments_read ON public.patient_tag_assignments FOR SELECT
  USING (tenant_id = public.jwt_tenant_id());

DROP POLICY IF EXISTS patient_tag_assignments_insert ON public.patient_tag_assignments;
CREATE POLICY patient_tag_assignments_insert ON public.patient_tag_assignments FOR INSERT
  WITH CHECK (tenant_id = public.jwt_tenant_id());

DROP POLICY IF EXISTS patient_tag_assignments_delete ON public.patient_tag_assignments;
CREATE POLICY patient_tag_assignments_delete ON public.patient_tag_assignments FOR DELETE
  USING (tenant_id = public.jwt_tenant_id());

-- Não há UPDATE significativo (tudo é IMMUTABLE depois de criado;
-- pra mudar a tag do paciente, basta DELETE + INSERT).
REVOKE UPDATE ON public.patient_tag_assignments FROM authenticated;
GRANT SELECT, INSERT, DELETE ON public.patient_tag_assignments TO authenticated;

NOTIFY pgrst, 'reload schema';
