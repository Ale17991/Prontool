-- 0150 — Modelos de laudo de exame configuráveis (backlog 2/2).
--
-- Template pré-estabelecido por TIPO de exame (começa em 'oftalmologico',
-- extensível). Define textos de cabeçalho, conclusão/observações e rodapé que o
-- laudo aplica sobre os dados estruturados do exame na geração do PDF. Os textos
-- suportam placeholders {{...}} (campos do exame + do paciente). `is_default`
-- marca qual modelo é aplicado automaticamente por tipo. Limites de tamanho são
-- validados na aplicação (Zod). Aditiva e idempotente.

CREATE TABLE IF NOT EXISTS public.exam_report_templates (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  exam_type       TEXT NOT NULL DEFAULT 'oftalmologico',
  name            TEXT NOT NULL,
  header_text     TEXT,
  conclusion_text TEXT,
  footer_text     TEXT,
  is_default      BOOLEAN NOT NULL DEFAULT false,
  created_by      UUID NOT NULL REFERENCES auth.users(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by      UUID REFERENCES auth.users(id),
  deleted_at      TIMESTAMPTZ,
  deleted_by      UUID REFERENCES auth.users(id)
);

CREATE INDEX IF NOT EXISTS exam_report_templates_type_idx
  ON public.exam_report_templates (tenant_id, exam_type, name)
  WHERE deleted_at IS NULL;

-- No máximo um default por (tenant, tipo de exame).
CREATE UNIQUE INDEX IF NOT EXISTS exam_report_templates_one_default_idx
  ON public.exam_report_templates (tenant_id, exam_type)
  WHERE is_default AND deleted_at IS NULL;

ALTER TABLE public.exam_report_templates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS exam_report_templates_read ON public.exam_report_templates;
CREATE POLICY exam_report_templates_read ON public.exam_report_templates
  FOR SELECT
  USING (tenant_id = public.jwt_tenant_id());

DROP POLICY IF EXISTS exam_report_templates_write ON public.exam_report_templates;
CREATE POLICY exam_report_templates_write ON public.exam_report_templates
  FOR ALL
  USING (
    tenant_id = public.jwt_tenant_id()
    AND public.jwt_role() IN ('admin', 'profissional_saude')
  )
  WITH CHECK (
    tenant_id = public.jwt_tenant_id()
    AND public.jwt_role() IN ('admin', 'profissional_saude')
  );

NOTIFY pgrst, 'reload schema';
