-- 0151 — Marcação manual de entrega ao paciente (backlog 1/4/2).
--
-- `issued_at` (0140) já marca quando o documento foi baixado p/ envio. Esta
-- migration acrescenta uma marcação MANUAL e explícita de "entregue ao paciente",
-- independente do download (a recepção pode confirmar a entrega por outros meios,
-- ou desfazer uma marcação). Aditiva e idempotente.

ALTER TABLE public.patient_documents
  ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS delivered_by UUID REFERENCES auth.users(id);

NOTIFY pgrst, 'reload schema';
