-- =========================================================================
-- 0219 — Resultado do envio ao CRM fica gravado no próprio ticket
--
-- O envio ao GHL é best-effort e por isso silencioso por desenho: falhar não
-- pode derrubar o ticket de quem estava pedindo ajuda. O efeito colateral foi
-- descobrir que "silencioso" também significa "não diagnosticável" — quatro
-- tentativas em produção, e a única fonte era o log da Vercel, que retém uma
-- janela curta e devolve poucas linhas por requisição. Duas causas reais
-- (sub-conta errada e contato sem e-mail) custaram rodadas de deploy só para
-- serem lidas.
--
--   D1  O desfecho vira DADO, não log. `crm_status` responde "o que aconteceu
--       com este ticket" em uma consulta, para sempre, sem depender de
--       retenção de log nem de a pessoa estar olhando na hora.
--
--   D2  `crm_detail` é JSONB e não texto: o que interessa muda por desfecho —
--       o status HTTP e o corpo num upsert recusado, a lista de campos numa
--       divergência de nome, o id do contato num sucesso. Texto obrigaria a
--       inventar um formato e depois a parseá-lo.
--
--   D3  Nulo é estado legítimo: ticket anterior a esta migration, ou criado
--       com o CRM desconfigurado, não tem desfecho a registrar. Não existe
--       "pendente" — a tentativa é síncrona e termina junto com a requisição.
--
-- `support_tickets` é append-only por GRANTS (0109), sem trigger. O service
-- role escreve estas duas colunas; `authenticated` continua sem UPDATE.
--
-- Reversibilidade: aditiva e idempotente.
-- =========================================================================

ALTER TABLE public.support_tickets
  ADD COLUMN IF NOT EXISTS crm_status TEXT  NULL,
  ADD COLUMN IF NOT EXISTS crm_detail JSONB NULL;

ALTER TABLE public.support_tickets
  DROP CONSTRAINT IF EXISTS support_tickets_crm_status_check;
ALTER TABLE public.support_tickets
  ADD CONSTRAINT support_tickets_crm_status_check CHECK (
    crm_status IS NULL OR crm_status IN (
      'enviado',        -- contato e nota entraram (card pode ou não ter entrado)
      'sem_config',     -- GHL_HOMIO_TOKEN/LOCATION_ID ausentes
      'sem_contato',    -- clínica sem e-mail nem telefone, e quem abriu sem e-mail
      'upsert_falhou',  -- o GHL recusou criar/achar o contato
      'nota_falhou',    -- contato existe, a nota não entrou
      'erro'            -- exceção inesperada
    )
  );

COMMENT ON COLUMN public.support_tickets.crm_status IS
  '0219 — desfecho do envio ao CRM da Homio. NULL = anterior a esta coluna ou CRM desconfigurado.';
COMMENT ON COLUMN public.support_tickets.crm_detail IS
  '0219 — contexto do desfecho (status HTTP, campos encontrados, id do contato). Formato varia por status de proposito.';

CREATE INDEX IF NOT EXISTS support_tickets_crm_status_idx
  ON public.support_tickets (crm_status, created_at DESC)
  WHERE crm_status IS NOT NULL AND crm_status <> 'enviado';
