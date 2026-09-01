-- =========================================================================
-- 0218 — Ponte entre clínica e o contato dela no CRM da Homio
--
-- Ticket de suporte/sugestão passa a virar contato no GHL da HOMIO. Isso é
-- destino de PLATAFORMA, e não se confunde com `tenant_integrations`, que
-- guarda a conexão GHL de cada CLÍNICA — mandar por lá criaria o lead dentro
-- do CRM da própria clínica que abriu o chamado, que é o oposto do objetivo.
--
--   D1  Uma linha por clínica, guardando o id do contato no GHL. O upsert do
--       GHL dedupe por e-mail/telefone, e clínica sem e-mail cadastrado
--       criaria um contato novo a cada ticket. Com a ponte, o segundo ticket
--       encontra o contato do primeiro por um id que não depende de o
--       cadastro estar completo.
--
--   D2  `ghl_location_id` fica junto porque o vínculo só vale DENTRO de uma
--       location. Se a Homio trocar de conta, o id antigo apontaria para um
--       contato que não existe lá — guardando a location, o código percebe e
--       recria em vez de escrever no vazio.
--
--   D3  Tabela de plataforma: sem `tenant_id` na RLS de leitura, sem policy
--       para `authenticated`. A clínica não tem por que saber que existe um
--       contato dela no nosso CRM, e isso não é dado dela.
--
-- Reversibilidade: aditiva e idempotente. Perder a tabela não perde nada no
-- GHL — na pior hipótese o próximo ticket recria o vínculo por upsert.
-- =========================================================================

CREATE TABLE IF NOT EXISTS public.tenant_crm_contacts (
  tenant_id       UUID        PRIMARY KEY REFERENCES public.tenants(id) ON DELETE CASCADE,
  ghl_contact_id  TEXT        NOT NULL CHECK (length(btrim(ghl_contact_id)) > 0),
  ghl_location_id TEXT        NOT NULL CHECK (length(btrim(ghl_location_id)) > 0),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Um contato pertence a uma clínica só, dentro da mesma location.
  UNIQUE (ghl_location_id, ghl_contact_id)
);

COMMENT ON TABLE public.tenant_crm_contacts IS
  '0218 — clinica -> contato no CRM da Homio (GHL). Plataforma, nao tenant: nada a ver com tenant_integrations, que e a conexao GHL de cada clinica.';

DROP TRIGGER IF EXISTS tenant_crm_contacts_touch_updated_at ON public.tenant_crm_contacts;
CREATE TRIGGER tenant_crm_contacts_touch_updated_at
  BEFORE UPDATE ON public.tenant_crm_contacts
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

ALTER TABLE public.tenant_crm_contacts ENABLE ROW LEVEL SECURITY;
-- Sem policy para `authenticated` (D3).
