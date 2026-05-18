-- 0086 — Defense-in-depth: trigger BEFORE INSERT em
-- doctor_payment_terms_history que rejeita INSERT onde
-- NEW.tenant_id <> doctors.tenant_id.
--
-- Por quê: a RPC `record_payment_terms_change` (0084, atualizada em 0085)
-- aceita p_tenant_id e p_doctor_id como parâmetros independentes e nao
-- validava cross-table. Combinado com furo de guard (corrigido em C3/0085),
-- abria um caminho para gravar history de doctor de tenant B numa row
-- marcada como tenant A — inconsistência silenciosa.
--
-- Espelha o padrão de `check_assistant_tenant_consistency` (0084:250-277).
-- Como é trigger no DB, vale para qualquer caminho de INSERT — incluindo
-- bypass RLS por service_role e qualquer RPC futura.

CREATE OR REPLACE FUNCTION public.check_payment_terms_tenant_consistency()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_doctor_tenant UUID;
BEGIN
  SELECT tenant_id INTO v_doctor_tenant
    FROM public.doctors WHERE id = NEW.doctor_id;

  IF v_doctor_tenant IS NULL THEN
    RAISE EXCEPTION 'doctor_payment_terms: doctor % nao encontrado.', NEW.doctor_id
      USING ERRCODE = '23503';
  END IF;

  IF NEW.tenant_id <> v_doctor_tenant THEN
    RAISE EXCEPTION 'PAYMENT_TERMS_TENANT_MISMATCH: row.tenant_id=% doctor.tenant_id=%',
      NEW.tenant_id, v_doctor_tenant
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS doctor_payment_terms_tenant_guard ON public.doctor_payment_terms_history;
CREATE TRIGGER doctor_payment_terms_tenant_guard
  BEFORE INSERT ON public.doctor_payment_terms_history
  FOR EACH ROW EXECUTE FUNCTION public.check_payment_terms_tenant_consistency();

NOTIFY pgrst, 'reload schema';
