-- 0123 — Métricas personalizadas por clínica em patient_metric_types.
--
-- Até aqui o catálogo era 100% global (seed endócrino da 0113), append-only e
-- sem nenhuma forma de a clínica cadastrar métricas próprias. Esta migration
-- abre o cadastro custom mantendo o catálogo global intacto:
--
--   1. patient_metric_types.tenant_id — NULL = métrica global (seed);
--      não-NULL = métrica personalizada daquela clínica.
--   2. Append-only PASSA A VALER SÓ para as linhas globais (tenant_id IS NULL):
--      o seed continua imutável; as métricas custom da clínica podem ser
--      editadas/desativadas/removidas por ela (base do "ativar/desativar").
--   3. RLS de escrita: admin da própria clínica gerencia só as SUAS linhas custom.
--   4. SELECT deixa de ser irrestrito — cada clínica enxerga global + as suas.
--   5. validate_patient_measurement passa a exigir que a métrica seja global OU
--      do mesmo tenant da medição (impede gravar com métrica custom de outra clínica).
--
-- metric_type continua PK GLOBAL — os FKs de patient_measurements e
-- tenant_patient_metric_settings ficam intactos. A unicidade entre clínicas é
-- garantida namespeando o slug custom (c<tenant8>_<slug>) na camada de app.
--
-- Constituição: III multi-tenant (tenant_id + RLS); V RBAC (escrita admin).
-- Reversibilidade: aditiva, idempotente. supabase:reset recria.

-- =========================================================================
-- 1. Coluna tenant_id (NULL = global)
-- =========================================================================

ALTER TABLE public.patient_metric_types
  ADD COLUMN IF NOT EXISTS tenant_id UUID NULL REFERENCES public.tenants(id) ON DELETE CASCADE;

COMMENT ON COLUMN public.patient_metric_types.tenant_id IS
  'NULL = métrica global (seed, imutável). Não-NULL = métrica personalizada da clínica. metric_type segue único globalmente (namespeado pela app: c<tenant8>_<slug>).';

CREATE INDEX IF NOT EXISTS patient_metric_types_tenant_idx
  ON public.patient_metric_types (tenant_id, specialty, display_order);

-- =========================================================================
-- 2. Append-only só para as linhas GLOBAIS; custom é editável pela clínica
-- =========================================================================

DROP TRIGGER IF EXISTS patient_metric_types_enforce_append_only ON public.patient_metric_types;
CREATE TRIGGER patient_metric_types_enforce_append_only
  BEFORE UPDATE OR DELETE ON public.patient_metric_types
  FOR EACH ROW WHEN (OLD.tenant_id IS NULL)
  EXECUTE FUNCTION public.enforce_append_only();

-- =========================================================================
-- 3. RLS — leitura escopada + escrita custom só admin da própria clínica
-- =========================================================================

-- Antes: SELECT irrestrito (USING TRUE). Agora cada clínica vê global + as suas.
DROP POLICY IF EXISTS patient_metric_types_read ON public.patient_metric_types;
CREATE POLICY patient_metric_types_read ON public.patient_metric_types
  FOR SELECT TO authenticated
  USING (tenant_id IS NULL OR tenant_id = public.jwt_tenant_id());

DROP POLICY IF EXISTS patient_metric_types_custom_insert ON public.patient_metric_types;
CREATE POLICY patient_metric_types_custom_insert ON public.patient_metric_types
  FOR INSERT TO authenticated
  WITH CHECK (tenant_id = public.jwt_tenant_id() AND public.jwt_role() = 'admin');

DROP POLICY IF EXISTS patient_metric_types_custom_update ON public.patient_metric_types;
CREATE POLICY patient_metric_types_custom_update ON public.patient_metric_types
  FOR UPDATE TO authenticated
  USING (tenant_id = public.jwt_tenant_id() AND public.jwt_role() = 'admin')
  WITH CHECK (tenant_id = public.jwt_tenant_id() AND public.jwt_role() = 'admin');

DROP POLICY IF EXISTS patient_metric_types_custom_delete ON public.patient_metric_types;
CREATE POLICY patient_metric_types_custom_delete ON public.patient_metric_types
  FOR DELETE TO authenticated
  USING (tenant_id = public.jwt_tenant_id() AND public.jwt_role() = 'admin');

GRANT INSERT, UPDATE, DELETE ON public.patient_metric_types TO authenticated;

-- =========================================================================
-- 4. validate_patient_measurement — métrica custom só do tenant dono
-- =========================================================================

CREATE OR REPLACE FUNCTION public.validate_patient_measurement()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_type public.patient_metric_types%ROWTYPE;
BEGIN
  SELECT * INTO v_type
    FROM public.patient_metric_types
    WHERE metric_type = NEW.metric_type;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING
      MESSAGE = format('METRIC_TYPE_UNKNOWN: %s não existe no catálogo patient_metric_types', NEW.metric_type),
      ERRCODE = '23514';
  END IF;
  -- Métrica custom (tenant_id não-NULL) só vale para a própria clínica.
  IF v_type.tenant_id IS NOT NULL AND v_type.tenant_id <> NEW.tenant_id THEN
    RAISE EXCEPTION USING
      MESSAGE = format('METRIC_TYPE_FOREIGN: %s pertence a outra clínica', NEW.metric_type),
      ERRCODE = '23514';
  END IF;
  IF NOT v_type.active THEN
    RAISE EXCEPTION USING
      MESSAGE = format('METRIC_TYPE_INACTIVE: %s está desativada no catálogo', NEW.metric_type),
      ERRCODE = '23514';
  END IF;
  IF NEW.unit IS NULL OR length(trim(NEW.unit)) = 0 THEN
    NEW.unit := v_type.unit;
  END IF;
  IF NEW.value < v_type.min_plausible OR NEW.value > v_type.max_plausible THEN
    RAISE EXCEPTION USING
      MESSAGE = format(
        'MEASUREMENT_OUT_OF_RANGE: %s=%s fora da faixa plausível [%s..%s] %s',
        NEW.metric_type, NEW.value, v_type.min_plausible, v_type.max_plausible, v_type.unit
      ),
      ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
