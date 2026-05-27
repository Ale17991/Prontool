-- 0107 — Campos do prescritor exigidos pela integração de prescrição
-- digital (Memed): CPF, UF do conselho e data de nascimento.
--
-- A Memed exige no cadastro do prescritor: cpf, board.board_state (UF do
-- conselho) e data_nascimento. O conselho já era guardado em council_name
-- (0039) + council_number, mas faltava a UF; CPF e nascimento não existiam.
--
-- Todas as colunas são NULLABLE de propósito:
--   - cadastros existentes não possuem esses dados;
--   - nem todo profissional prescreve (a marca atende qualquer clínica).
-- A obrigatoriedade é validada no momento de registrar o prescritor na
-- Memed, não no cadastro do profissional.
--
-- Armazenamento em texto plano segue o padrão já adotado nesta tabela
-- (full_name, crm, council_number não são cifrados). CPF e registro de
-- conselho constam na própria receita — não são tratados como PII cifrada
-- de paciente (que vive em colunas *_enc).

ALTER TABLE public.doctors
  ADD COLUMN IF NOT EXISTS cpf TEXT,
  ADD COLUMN IF NOT EXISTS council_state TEXT,
  ADD COLUMN IF NOT EXISTS birth_date DATE;
