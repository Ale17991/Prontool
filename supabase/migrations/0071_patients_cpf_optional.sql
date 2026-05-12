-- 0071 — CPF opcional no cadastro de paciente (fase de testes).
--
-- Originalmente `cpf_enc BYTEA NOT NULL` (migration 0007). Em fase de
-- testes, permitir paciente sem CPF facilita o onboarding (anamnese
-- minimalista, paciente sem documento ainda).
--
-- Quando o CPF FOR informado, o app continua:
--   - validando formato (11 digitos)
--   - checando duplicidade no tenant
--   - encriptando em cpf_enc
--
-- Quando o CPF NAO for informado, cpf_enc fica NULL — sem duplicidade
-- pra checar. Reversibilidade: aditiva e idempotente.

ALTER TABLE public.patients
  ALTER COLUMN cpf_enc DROP NOT NULL;

COMMENT ON COLUMN public.patients.cpf_enc IS
  'CPF encriptado. NULL permitido (paciente sem CPF cadastrado — fase de testes). Quando preenchido, encriptado com a chave do tenant.';
