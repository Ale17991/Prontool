-- =====================================================================
-- Feature 053 — aniversariantes do dia, para a família de celebração.
--
-- Existe porque `patients.birth_date_enc` é cifrado: descobrir quem faz
-- aniversário hoje em TypeScript exigiria uma chamada de decrypt por paciente,
-- todo dia, para a base inteira — N+1 sobre todos os pacientes de todas as
-- clínicas.
--
-- Mesma abordagem que a 0078 já usa para os "aniversariantes do mês": o
-- decrypt acontece DENTRO do banco, num SECURITY DEFINER, e só os ids saem.
-- A chave vai como parâmetro em vez de `current_setting` porque o ciclo roda
-- com service-role, sem sessão configurada.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.signals_birthdays_today(
  p_tenant_id UUID,
  p_key       TEXT,
  p_today     DATE
) RETURNS TABLE (patient_id UUID)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
  SELECT p.id
  FROM public.patients p
  WHERE p.tenant_id = p_tenant_id
    AND p.birth_date_enc IS NOT NULL
    AND p.anonymized_at IS NULL
    -- `status = 'ativo'` não é só higiene de cadastro: o CHECK da 0136 admite
    -- 'obito'. Mandar "feliz aniversário" para a família de um paciente que
    -- morreu é o pior erro que esta feature inteira poderia cometer, e é o
    -- filtro que o impede.
    AND p.status = 'ativo'
    -- Dia e mês, nunca o ano. Comparar a data inteira só acertaria no dia em
    -- que a pessoa nasceu.
    AND extract(month FROM extensions.pgp_sym_decrypt(p.birth_date_enc, p_key)::date)::int
        = extract(month FROM p_today)::int
    AND extract(day FROM extensions.pgp_sym_decrypt(p.birth_date_enc, p_key)::date)::int
        = extract(day FROM p_today)::int
$$;

COMMENT ON FUNCTION public.signals_birthdays_today IS
  'Feature 053 — ids dos pacientes que fazem aniversário na data dada. Decrypt dentro do banco para evitar N+1 sobre a base inteira. Só devolve id: nome e data continuam sem sair cifrados.';

-- Só o service-role chama: é o ciclo do cron. Nenhum usuário autenticado
-- precisa desta função, e conceder a mais seria abrir um caminho de leitura
-- de data de nascimento que não existe hoje.
REVOKE ALL ON FUNCTION public.signals_birthdays_today(UUID, TEXT, DATE) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.signals_birthdays_today(UUID, TEXT, DATE) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.signals_birthdays_today(UUID, TEXT, DATE) TO service_role;
