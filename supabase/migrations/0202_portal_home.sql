-- 0202 — A home do portal do paciente (057).
--
-- O portal era uma tela só, rolante: resumo, gráficos, histórico, treino, dieta
-- e exames empilhados. No celular — que é onde o paciente está — isso enterrava
-- o checklist de hábitos, a única coisa que ele de fato FAZ ali, no meio de
-- conteúdo que ele só consulta de vez em quando. A tela inicial passa a mostrar
-- metas e checklist, e cada outra área vira uma página própria.
--
-- Quase tudo isso é apresentação e não toca o banco. Duas coisas tocam.
--
-- O TEXTO DE BOAS-VINDAS
--
-- A clínica pode desligar metas e hábitos, e o paciente pode não ter meta
-- nenhuma. Nesse caso a tela inicial ficaria só com os cards. Ela passa a
-- mostrar um recado da clínica — quando houver — mais a primeira área com
-- conteúdo, aberta.
--
-- O texto mora aqui, junto de `patient_portal_enabled` e `public_booking_slug`,
-- porque é a mesma natureza: configuração do portal daquela clínica. Tabela
-- própria para um campo de texto opcional seria cerimônia sem ganho.
--
-- Nasce NULL e assim fica para todas as clínicas existentes: "não escreveu
-- nada" é o estado correto de quem nunca foi perguntado. O limite de 1.000
-- caracteres é da aplicação, não daqui — é regra de produto (a tela existe para
-- ser curta), e regra de produto que muda não deveria exigir migration.
--
-- A ÁREA NA TRILHA DE ACESSO
--
-- Cada página aberta vira uma linha em `patient_portal_access_log` (LGPD). Com
-- a navegação, uma visita que era 1 registro passa a ser 5 ou 6 — e todos
-- diriam apenas `view`, porque a trilha nunca registrou ONDE o paciente esteve.
-- Seria mais volume carregando a mesma informação.
--
-- A alternativa era criar valores novos de `action` (`view_exames`,
-- `view_dieta`…). Recusada: obrigaria a mexer no CHECK a cada área nova e
-- misturaria duas dimensões — o que a pessoa fez e onde ela estava. Coluna
-- separada mantém `action` estável e deixa as duas perguntas independentes.
--
-- A coluna é NULÁVEL e as linhas antigas NÃO são retroalimentadas. A tabela é
-- append-only: não se reescreve o passado para fazê-lo parecer mais completo do
-- que foi. `section IS NULL` passa a significar, sem ambiguidade, "acesso
-- anterior à 057".
--
-- Sem CHECK enumerando as seções, pelo mesmo motivo que
-- `automation_triggers.source` não tem: área nova é um arquivo em `sections.ts`,
-- e não deveria custar uma migration.

ALTER TABLE public.tenant_clinic_profile
  ADD COLUMN IF NOT EXISTS patient_portal_welcome_text TEXT;

ALTER TABLE public.patient_portal_access_log
  ADD COLUMN IF NOT EXISTS section TEXT;

COMMENT ON COLUMN public.tenant_clinic_profile.patient_portal_welcome_text IS
  'Feature 057 — recado de acolhimento exibido na tela inicial do portal APENAS quando nem metas nem checklist de hábitos têm o que exibir. Não é mural: clínica com texto cadastrado e paciente com metas ativas não vê o texto. NULL = a clínica nunca escreveu nada; string vazia é normalizada para NULL na aplicação, para não existirem dois jeitos de dizer a mesma coisa.';

COMMENT ON COLUMN public.patient_portal_access_log.section IS
  'Feature 057 — qual área do portal foi aberta (`home`, `metricas`, `atendimentos`, `orientacoes`, `exames`, `treino`, `dieta`). Sem CHECK de propósito: área nova não deve exigir migration. NULL identifica os acessos gravados ANTES da 057, quando a trilha só sabia dizer que houve um `view` — as linhas antigas não foram retroalimentadas porque a tabela é append-only.';

NOTIFY pgrst, 'reload schema';
