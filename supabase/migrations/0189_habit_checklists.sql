-- 0189 — Checklist de hábitos: a clínica monta a grade, o PACIENTE marca.
--
-- Rastreador simples: linhas = perguntas curtas ("bateu a meta de água hoje?"),
-- colunas = dias do período. Cada marcação é um registro de (item × data) — e
-- não um "feito/não feito" por item. É essa granularidade que permite sequência
-- de dias seguidos e relatório por período.
--
-- TRÊS DECISÕES QUE O SCHEMA PRECISA HONRAR:
--
-- 1. **Marcação é binária e o branco é AMBÍGUO de propósito**: linha presente =
--    marcou; linha ausente = não se sabe se deixou de fazer ou não abriu o app.
--    Por isso não existe coluna `done BOOLEAN` — ela obrigaria a inventar um
--    valor para o branco. Desmarcar APAGA a linha.
--
-- 2. **O período NÃO é materializado.** A grade "renova sozinha" porque a
--    marcação é gravada por data absoluta e o período corrente é calculado a
--    partir de `start_date` + `period_kind`. Sem cron, sem períodos vazios
--    criados para sempre, e o histórico existe de graça.
--
-- 3. **Lista base da clínica → cópia ajustável por paciente** (padrão dos grupos
--    alimentares da 047/0180): `items` é JSONB nas duas pontas. Ajustar o
--    checklist de um paciente NÃO toca no modelo da clínica.
--
-- O paciente escreve pelo portal, mas NUNCA via RLS de `authenticated`: o portal
-- não tem usuário no `auth.users` — a identidade vem do cookie HMAC e a escrita
-- passa pelo service client, que resolve tenant+paciente da SESSÃO. Por isso as
-- policies abaixo cobrem só a equipe da clínica.

-- Modelo da clínica: a lista base de hábitos.
CREATE TABLE IF NOT EXISTS public.habit_checklist_templates (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  title       TEXT NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 120),
  -- [{ id, label }] — mesma forma do checklist do paciente, para a cópia ser
  -- literal e não uma tradução entre dois formatos.
  items       JSONB NOT NULL DEFAULT '[]'::jsonb,
  active      BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS habit_checklist_templates_tenant_idx
  ON public.habit_checklist_templates (tenant_id, title);

-- A grade de um paciente. `items` nasce como cópia do modelo e segue a vida
-- própria dele.
CREATE TABLE IF NOT EXISTS public.patient_habit_checklists (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  patient_id   UUID NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
  title        TEXT NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 120),
  period_kind  TEXT NOT NULL DEFAULT 'semanal'
               CHECK (period_kind IN ('semanal','quinzenal','mensal')),
  start_date   DATE NOT NULL,
  items        JSONB NOT NULL DEFAULT '[]'::jsonb,
  active       BOOLEAN NOT NULL DEFAULT TRUE,
  created_by_user_id UUID NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS patient_habit_checklists_patient_idx
  ON public.patient_habit_checklists (tenant_id, patient_id, active);

-- Marcações. Uma linha = "este hábito foi cumprido neste dia".
CREATE TABLE IF NOT EXISTS public.habit_checklist_marks (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  checklist_id  UUID NOT NULL REFERENCES public.patient_habit_checklists(id) ON DELETE CASCADE,
  patient_id    UUID NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
  -- Id do item DENTRO do JSONB do checklist. Não é FK: o item vive no JSONB
  -- justamente para ser ajustável por paciente.
  item_id       TEXT NOT NULL CHECK (length(item_id) BETWEEN 1 AND 60),
  mark_date     DATE NOT NULL,
  -- Quem marcou. Hoje só o paciente marca; a coluna existe para o dia em que a
  -- equipe puder marcar em nome dele, sem migration nova.
  marked_by     TEXT NOT NULL DEFAULT 'paciente' CHECK (marked_by IN ('paciente','equipe')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Marcar duas vezes o mesmo dia é a mesma afirmação. O UNIQUE torna o
  -- "marcar" idempotente e impede que um toque duplo no celular vire dois
  -- registros e dobre a contagem de dias.
  UNIQUE (checklist_id, item_id, mark_date)
);

CREATE INDEX IF NOT EXISTS habit_checklist_marks_lookup_idx
  ON public.habit_checklist_marks (checklist_id, mark_date);

DROP TRIGGER IF EXISTS habit_checklist_templates_touch ON public.habit_checklist_templates;
CREATE TRIGGER habit_checklist_templates_touch
  BEFORE UPDATE ON public.habit_checklist_templates
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

DROP TRIGGER IF EXISTS patient_habit_checklists_touch ON public.patient_habit_checklists;
CREATE TRIGGER patient_habit_checklists_touch
  BEFORE UPDATE ON public.patient_habit_checklists
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'habit_checklist_templates','patient_habit_checklists','habit_checklist_marks'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I_read ON public.%I', t, t);
    EXECUTE format(
      'CREATE POLICY %I_read ON public.%I FOR SELECT TO authenticated USING (tenant_id = public.jwt_tenant_id())',
      t, t);
    EXECUTE format('DROP POLICY IF EXISTS %I_write ON public.%I', t, t);
    EXECUTE format(
      'CREATE POLICY %I_write ON public.%I FOR ALL TO authenticated USING (tenant_id = public.jwt_tenant_id() AND public.jwt_role() IN (''admin'',''profissional_saude'')) WITH CHECK (tenant_id = public.jwt_tenant_id() AND public.jwt_role() IN (''admin'',''profissional_saude''))',
      t, t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO authenticated', t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', t);
  END LOOP;
END $$;

-- A marcação é a PRIMEIRA escrita do paciente no portal — merece rastro no
-- mesmo log dos acessos. O CHECK da 0113 só previa leitura.
ALTER TABLE public.patient_portal_access_log
  DROP CONSTRAINT IF EXISTS patient_portal_access_log_action_check;
ALTER TABLE public.patient_portal_access_log
  ADD CONSTRAINT patient_portal_access_log_action_check
  CHECK (action IN ('login_ok', 'login_fail', 'view', 'habit_mark'));
