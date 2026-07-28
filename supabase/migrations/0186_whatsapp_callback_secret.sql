-- =========================================================================
-- Feature 051 — US4: segredo do callback de confirmação de entrega
--
-- O serviço de envio devolve, no provisionamento, um `callbackSecret` POR
-- CLÍNICA, que ele usa como Bearer ao nos avisar que a mensagem foi entregue
-- ou lida. A 0185 guardou só a `api_key` — o segredo era descartado.
--
-- Sem ele a rota `/api/webhooks/whatsapp-status` não teria contra o que
-- validar, e a alternativa (aceitar qualquer POST) deixaria qualquer um
-- forjar "entregue"/"lida" no histórico da clínica.
--
-- Por clínica e não global: um segredo único vazado comprometeria todas as
-- clínicas de uma vez, e rotacioná-lo exigiria reprovisionar todo mundo.
-- =========================================================================

ALTER TABLE public.tenant_whatsapp_config
  ADD COLUMN IF NOT EXISTS callback_secret_enc BYTEA;

COMMENT ON COLUMN public.tenant_whatsapp_config.callback_secret_enc IS
  'Feature 051 — segredo que o serviço de envio apresenta como Bearer no callback de entrega. Cifrado via enc_text_with_key(PATIENT_DATA_ENCRYPTION_KEY), nunca retornado ao browser. NULL nas conexões criadas antes da 0186; elas recebem o segredo na próxima reconexão.';
