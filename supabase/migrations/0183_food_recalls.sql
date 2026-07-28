-- 0183 — Recordatório alimentar R24h (feature 049 US3).
--
-- Registro do consumo real de UM dia por paciente (refeições + itens com
-- quantidade), reusando a base de alimentos e o motor de soma. Editável (não é
-- prescrição imutável). Gated pelo módulo `nutri_recordatorio` na aplicação.
--
-- Constituição: III multi-tenant (tenant_id + RLS); V RBAC (escrita
-- admin/profissional_saude). Reversível/idempotente.

CREATE TABLE IF NOT EXISTS public.food_recalls (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  patient_id          UUID NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
  recall_date         DATE NOT NULL,
  notes               TEXT NULL,
  created_by_user_id  UUID NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS food_recalls_patient_idx
  ON public.food_recalls (tenant_id, patient_id, recall_date DESC);

CREATE TABLE IF NOT EXISTS public.food_recall_items (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recall_id      UUID NOT NULL REFERENCES public.food_recalls(id) ON DELETE CASCADE,
  tenant_id      UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  meal_name      TEXT NOT NULL,
  position       INT NOT NULL DEFAULT 0,
  food_id        UUID NOT NULL REFERENCES public.foods(id),
  grams          NUMERIC(8,2) NULL CHECK (grams IS NULL OR (grams > 0 AND grams <= 5000)),
  measure_label  TEXT NULL,
  measure_qty    NUMERIC(8,2) NULL
);
CREATE INDEX IF NOT EXISTS food_recall_items_recall_idx
  ON public.food_recall_items (recall_id);

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['food_recalls','food_recall_items'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I_read ON public.%I', t, t);
    EXECUTE format(
      'CREATE POLICY %I_read ON public.%I FOR SELECT TO authenticated USING (tenant_id = public.jwt_tenant_id())',
      t, t);
    EXECUTE format('DROP POLICY IF EXISTS %I_write ON public.%I', t, t);
    EXECUTE format(
      'CREATE POLICY %I_write ON public.%I FOR ALL TO authenticated USING (tenant_id = public.jwt_tenant_id() AND public.jwt_role() IN (''admin'',''profissional_saude'')) WITH CHECK (tenant_id = public.jwt_tenant_id() AND public.jwt_role() IN (''admin'',''profissional_saude''))',
      t, t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO authenticated', t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', t);
  END LOOP;
END $$;
