-- 0178 — RPC atômica de prescrição de plano alimentar (feature 047, US2).
--
-- A prescrição (FR-013) precisa ser UMA operação atômica (Constituição I): grava
-- o snapshot imutável, congela os nutrientes de cada item (snap_*) e marca o
-- plano como prescrito. Meio-caminho geraria plano "prescrito" sem retrato, ou
-- itens congelados sem prescrição. O motor de soma roda em TS (fonte única com
-- o cliente); esta função apenas PERSISTE, atomicamente, o que o TS calculou.

CREATE OR REPLACE FUNCTION public.prescribe_diet_plan(
  p_tenant_id     UUID,
  p_patient_id    UUID,
  p_plan_id       UUID,
  p_actor_user_id UUID,
  p_snapshot      JSONB,
  p_target_kcal   NUMERIC,
  p_target_macros JSONB,
  p_total_kcal    NUMERIC,
  p_total_macros  JSONB,
  p_item_snaps    JSONB   -- [{item_id, energy, protein, carb, fat, fiber}, ...]
)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_prescription_id UUID;
  v_plan RECORD;
BEGIN
  -- O plano tem de existir, ser do tenant e do paciente informados.
  SELECT id, status INTO v_plan
  FROM public.diet_plans
  WHERE id = p_plan_id AND tenant_id = p_tenant_id AND patient_id = p_patient_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'DIET_PLAN_NOT_FOUND' USING ERRCODE = '23503';
  END IF;

  -- Congela os nutrientes de cada item (snap_*).
  UPDATE public.diet_meal_items i
  SET snap_energy_kcal = (s->>'energy')::numeric,
      snap_protein_g   = (s->>'protein')::numeric,
      snap_carb_g      = (s->>'carb')::numeric,
      snap_fat_g       = (s->>'fat')::numeric,
      snap_fiber_g     = NULLIF(s->>'fiber','')::numeric
  FROM jsonb_array_elements(p_item_snaps) AS s
  WHERE i.id = (s->>'item_id')::uuid
    AND i.tenant_id = p_tenant_id;

  -- Registra a prescrição (append-only; trigger de auditoria dispara).
  INSERT INTO public.diet_plan_prescriptions
    (tenant_id, patient_id, plan_id, prescribed_by_user_id, snapshot,
     target_kcal, target_macros, total_kcal, total_macros)
  VALUES
    (p_tenant_id, p_patient_id, p_plan_id, p_actor_user_id, p_snapshot,
     p_target_kcal, p_target_macros, p_total_kcal, p_total_macros)
  RETURNING id INTO v_prescription_id;

  -- Marca o plano como prescrito.
  UPDATE public.diet_plans
  SET status = 'prescrito', updated_at = now()
  WHERE id = p_plan_id;

  RETURN v_prescription_id;
END $$;

GRANT EXECUTE ON FUNCTION public.prescribe_diet_plan(
  UUID, UUID, UUID, UUID, JSONB, NUMERIC, JSONB, NUMERIC, JSONB, JSONB
) TO authenticated, service_role;
