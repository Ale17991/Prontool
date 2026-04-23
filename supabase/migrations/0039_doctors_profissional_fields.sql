-- 0039 — Adequa a tabela doctors para o universo amplo de profissionais
-- de saúde (médicos, dentistas, fisioterapeutas, psicólogos, etc.).
--
-- O nome da tabela (doctors) e a coluna crm NÃO mudam — isso preservaria
-- a compatibilidade com (a) dados já cadastrados com CRM, (b) o webhook
-- GHL que identifica por crm, e (c) a FK em appointments/commission_history.
-- Todos os rótulos e labels na UI passam a ser "profissional"; o banco
-- fica com o nome técnico legado, documentado aqui.
--
-- Novas colunas:
--   - role          função do profissional (Médico, Dentista, Fisio etc.)
--                   NOT NULL DEFAULT 'profissional' — rows existentes
--                   recebem esse valor genérico até serem reclassificadas.
--   - specialty     especialidade dentro da função (Ortopedia, Endodontia...)
--                   nullable — nem toda profissão tem especialidade formal.
--   - council_name  nome do conselho (CRM, CRO, CREFITO, CFP...)
--                   nullable — para rows antigas o conselho está implícito
--                   no conteúdo do campo crm (ex: "CRM-12345").
--   - council_number número no conselho; nullable, substitui crm na UI
--                   pra cadastros novos. Rows antigas continuam exibindo
--                   o valor de crm via fallback no app.

ALTER TABLE public.doctors
  ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'profissional',
  ADD COLUMN IF NOT EXISTS specialty TEXT,
  ADD COLUMN IF NOT EXISTS council_name TEXT,
  ADD COLUMN IF NOT EXISTS council_number TEXT;

CREATE INDEX IF NOT EXISTS doctors_role_idx ON public.doctors (tenant_id, role);
