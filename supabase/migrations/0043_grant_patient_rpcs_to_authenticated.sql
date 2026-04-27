-- O page /operacao/pacientes chama list_patients_for_tenant via RLS client
-- (role authenticated). A migration 0027 só concedeu EXECUTE para
-- service_role, então em produção a chamada falha com "permission denied"
-- e a Server Component crasha em tela branca de "Application error".
--
-- A função é SECURITY DEFINER e já filtra por p_tenant_id, e a RLS de
-- patients filtra por jwt_tenant_id() — concedê-la a authenticated mantém
-- o mesmo isolamento de tenant que já estava em vigor.

GRANT EXECUTE ON FUNCTION public.list_patients_for_tenant(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_patient_for_tenant(UUID, UUID, TEXT) TO authenticated;
