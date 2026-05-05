-- 0063 — Feature 008 follow-up: permite created_by_user_id NULL em
-- tenant_integrations para o caminho de marketplace install (actor =
-- 'system:ghl_marketplace_install', sem user_id real).
--
-- Audit trail continua granular via audit_log (actor_label preservado);
-- a coluna created_by_user_id continua sendo a fonte de "qual admin
-- conectou" quando aplicável (manual_connect).

ALTER TABLE public.tenant_integrations
  ALTER COLUMN created_by_user_id DROP NOT NULL;
