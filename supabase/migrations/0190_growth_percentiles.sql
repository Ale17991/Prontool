-- 0190 — Curvas de crescimento infantil: percentis de peso, estatura e IMC.
--
-- Catálogo GLOBAL read-only, no mesmo padrão de `lab_reference_ranges` (0184) e
-- `dietary_reference_intakes` (0182): são tabelas da OMS, iguais para toda
-- clínica, mantidas por script de seed e nunca editadas pelo usuário.
--
-- **As medições NÃO ganham tabela**: peso, estatura e IMC já vivem em
-- `vital_signs` (`weight_grams`, `height_cm`, `bmi`) desde o núcleo do produto,
-- com data de aferição. A curva é leitura — cruza o que já existe com estes
-- percentis e a data de nascimento do paciente. Criar tabela nova aqui seria
-- fragmentar antropometria em dois lugares.
--
-- Formato LARGO (uma linha por indicador × sexo × mês, com as 9 colunas de
-- percentil) em vez de longo: a consulta que a tela faz é sempre "me dê a faixa
-- inteira desta idade", e no formato longo isso seriam 9 linhas para remontar.
-- É também a forma exata da fonte, o que torna o seed conferível linha a linha.

CREATE TABLE IF NOT EXISTS public.growth_percentiles (
  id            BIGSERIAL PRIMARY KEY,
  -- peso_idade | estatura_idade | imc_idade
  indicator     TEXT NOT NULL CHECK (indicator IN ('peso_idade','estatura_idade','imc_idade')),
  sex           TEXT NOT NULL CHECK (sex IN ('M','F')),
  age_months    INT NOT NULL CHECK (age_months >= 0 AND age_months <= 240),
  p01           NUMERIC(8,2) NOT NULL,
  p3            NUMERIC(8,2) NOT NULL,
  p5            NUMERIC(8,2) NOT NULL,
  p10           NUMERIC(8,2) NOT NULL,
  p15           NUMERIC(8,2) NOT NULL,
  p50           NUMERIC(8,2) NOT NULL,
  p85           NUMERIC(8,2) NOT NULL,
  p97           NUMERIC(8,2) NOT NULL,
  p999          NUMERIC(8,2) NOT NULL,
  -- Reexecutar o seed atualiza em vez de duplicar.
  UNIQUE (indicator, sex, age_months)
);

CREATE INDEX IF NOT EXISTS growth_percentiles_lookup_idx
  ON public.growth_percentiles (indicator, sex, age_months);

ALTER TABLE public.growth_percentiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS growth_percentiles_read ON public.growth_percentiles;
CREATE POLICY growth_percentiles_read ON public.growth_percentiles
  FOR SELECT TO authenticated USING (true);

-- Sem GRANT de escrita: manutenção só por service_role (script de seed).
GRANT SELECT ON public.growth_percentiles TO authenticated, service_role;
GRANT ALL ON public.growth_percentiles TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.growth_percentiles_id_seq TO service_role;
