-- 0184 — Exames laboratoriais: faixas de referência + catálogo de analitos.
-- Feature 050 (cross-especialidade, gated pelo módulo `exames_lab`).
--
-- Os RESULTADOS não ganham tabela: reusam o motor de medições da feature 030
-- (`patient_measurements`, append-only, RLS por tenant). É o precedente literal
-- — a 0113 já semeou 7 exames laboratoriais nesse motor. Esta migration
-- acrescenta (1) o catálogo de analitos em `patient_metric_types` e (2) a tabela
-- global de faixas de referência por sexo/idade/estado.
--
-- Constituição: III (catálogo global read-only + resultados isolados por tenant),
-- V (RBAC herdado das policies de patient_measurements). Idempotente.

-- =========================================================================
-- 1. Faixas de referência — catálogo GLOBAL (sem tenant_id), read-only.
--    Espelha `dietary_reference_intakes` (0182), com uma diferença material:
--    lá há um `value` único (alvo, adequação em %); aqui há DOIS limites
--    absolutos e independentemente NULÁVEIS, porque a fonte tem exames só com
--    teto (LDL, triglicérides: "abaixo de X") e só com piso (HDL, apo A-I).
-- =========================================================================
CREATE TABLE IF NOT EXISTS public.lab_reference_ranges (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  analyte_key    TEXT NOT NULL,
  sex            TEXT NOT NULL CHECK (sex IN ('M','F','any')),
  age_min_years  NUMERIC(6,2) NOT NULL,
  age_max_years  NUMERIC(6,2) NOT NULL,
  state          TEXT NOT NULL DEFAULT 'padrao' CHECK (state IN ('padrao','gestante','lactante')),
  ref_min        NUMERIC(14,4) NULL,
  ref_max        NUMERIC(14,4) NULL,
  unit           TEXT NOT NULL,
  source_label   TEXT NULL,
  CONSTRAINT lab_range_natural_key UNIQUE (analyte_key, sex, age_min_years, age_max_years, state),
  CONSTRAINT lab_range_age_chk CHECK (age_max_years > age_min_years),
  -- Linha sem nenhum limite não tem razão de existir.
  CONSTRAINT lab_range_has_limit_chk CHECK (ref_min IS NOT NULL OR ref_max IS NOT NULL),
  CONSTRAINT lab_range_order_chk CHECK (ref_min IS NULL OR ref_max IS NULL OR ref_max >= ref_min)
);

CREATE INDEX IF NOT EXISTS lab_range_lookup_idx
  ON public.lab_reference_ranges (analyte_key, sex, state);

ALTER TABLE public.lab_reference_ranges ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lab_range_read ON public.lab_reference_ranges;
CREATE POLICY lab_range_read ON public.lab_reference_ranges
  FOR SELECT TO authenticated USING (true);
-- Sem GRANT de escrita: manutenção só por service_role (script de seed).
GRANT SELECT ON public.lab_reference_ranges TO authenticated, service_role;

-- Fora do catalog_baseline, como a 0182: o seed é re-executável e os testes
-- inserem as próprias faixas (self-contained).

-- =========================================================================
-- 2. Catálogo de analitos em patient_metric_types (specialty='laboratorio').
--
--    ATENÇÃO à faixa plausível: min_plausible/max_plausible são ANTI-TYPO, não
--    faixa de referência clínica. Ficam folgados de propósito (~10x o maior
--    limite de referência conhecido; 100 para unidades em %), senão o trigger
--    `validate_patient_measurement` rejeitaria no INSERT justamente o resultado
--    clinicamente muito alterado — o caso que mais importa registrar.
--
--    Os exames já semeados na 0113 (glicemia_jejum, hba1c, colesterol_total,
--    ldl, hdl, triglicerides) NÃO são reinseridos nem remarcados: linhas globais
--    de patient_metric_types são append-only e já têm séries históricas. O
--    catálogo TS (src/lib/core/labs/catalog.ts) os declara com a chave legada.
-- =========================================================================
INSERT INTO public.patient_metric_types
  (metric_type, label, unit, min_plausible, max_plausible, specialty, display_order)
VALUES
  ('lab_homa_beta', 'HOMA-beta', 'mmol/L', 0, 2000, 'laboratorio', 30),
  ('lab_insulina', 'Insulina', 'mUI/L', 0, 100, 'laboratorio', 40),
  ('lab_proinsulina', 'Pró-insulina', 'pmol/L', 0, 100, 'laboratorio', 50),
  ('lab_apo_a1', 'Apolipoproteína A-I', 'mg/dL', 0, 2000, 'laboratorio', 60),
  ('lab_apo_b', 'Apolipoproteína B', 'mg/dL', 0, 1000, 'laboratorio', 70),
  ('lab_adiponectina', 'Adiponectina', 'mcg/mL', 0, 200, 'laboratorio', 90),
  ('lab_coenzima_q10', 'Coenzima Q10', 'mg/L', 0, 10, 'laboratorio', 100),
  ('lab_homocisteina', 'Homocisteína', 'µmol/L', 0, 100, 'laboratorio', 120),
  ('lab_ldl_oxidado', 'LDL oxidado', 'mcg/mL', 0, 500, 'laboratorio', 130),
  ('lab_lp_pla2', 'Lp-PLA2', 'ng/mL', 0, 5000, 'laboratorio', 140),
  ('lab_lipoproteina_a', 'Lp(a)', 'mg/dL', 0, 500, 'laboratorio', 150),
  ('lab_mieloperoxidase', 'Mieloperoxidase', 'pmol/L', 0, 5000, 'laboratorio', 160),
  ('lab_pcr_us', 'PCR ultrassensível', 'mg/dL', 0, 50, 'laboratorio', 170),
  ('lab_basofilos', 'Basófilos', '%', 0, 100, 'laboratorio', 190),
  ('lab_chcm', 'CHCM', 'g/dL', 0, 500, 'laboratorio', 200),
  ('lab_eosinofilos', 'Eosinófilos', '%', 0, 100, 'laboratorio', 210),
  ('lab_fibrinogenio', 'Fibrinogênio', 'mg/dL', 0, 5000, 'laboratorio', 220),
  ('lab_hcm', 'HCM', 'pg', 0, 500, 'laboratorio', 230),
  ('lab_hemacias', 'Hemácias (eritrócitos)', '10⁶/mm³', 0, 100, 'laboratorio', 240),
  ('lab_hematocrito', 'Hematócrito', '%', 0, 100, 'laboratorio', 250),
  ('lab_hemoglobina', 'Hemoglobina', 'g/dL', 0, 200, 'laboratorio', 260),
  ('lab_holotranscobalamina', 'Holotranscobalamina', 'pmol/L', 0, 1000, 'laboratorio', 270),
  ('lab_leucocitos', 'Leucócitos (contagem diferencial)', 'mm³', 0, 100000, 'laboratorio', 280),
  ('lab_linfocitos', 'Linfócitos', '%', 0, 100, 'laboratorio', 290),
  ('lab_monocitos', 'Monócitos', '%', 0, 100, 'laboratorio', 300),
  ('lab_neutrofilos', 'Neutrófilos', '%', 0, 100, 'laboratorio', 310),
  ('lab_plaquetas', 'Plaquetas', 'mm³', 0, 5000000, 'laboratorio', 320),
  ('lab_rdw', 'RDW', '%', 0, 100, 'laboratorio', 330),
  ('lab_vcm', 'VCM', 'fL', 0, 1000, 'laboratorio', 340),
  ('lab_vsg', 'VSG', 'mm', 0, 100, 'laboratorio', 350),
  ('lab_ferritina', 'Ferritina', 'mcg/L', 0, 2000, 'laboratorio', 360),
  ('lab_saturacao_transferrina', 'Saturação da transferrina', '%', 0, 100, 'laboratorio', 370),
  ('lab_bilirrubina_direta', 'Bilirrubina direta', 'mg/dL', 0, 5, 'laboratorio', 380),
  ('lab_bilirrubina_indireta', 'Bilirrubina indireta', 'mg/dL', 0, 20, 'laboratorio', 390),
  ('lab_bilirrubina_total', 'Bilirrubina total', 'mg/dL', 0, 10, 'laboratorio', 400),
  ('lab_fosfatase_alcalina', 'Fosfatase alcalina', 'U/L', 0, 1000, 'laboratorio', 410),
  ('lab_ggt', 'GGT', 'U/L', 0, 500, 'laboratorio', 420),
  ('lab_tgo', 'TGO (AST)', 'U/L', 0, 500, 'laboratorio', 430),
  ('lab_tgp', 'TGP (ALT)', 'U/L', 0, 500, 'laboratorio', 440),
  ('lab_acido_urico', 'Ácido úrico', 'mg/dL', 0, 50, 'laboratorio', 450),
  ('lab_calcio_ionico', 'Cálcio iônico', 'mg/dL', 0, 100, 'laboratorio', 460),
  ('lab_ureia', 'Ureia', 'mg/dL', 0, 500, 'laboratorio', 470),
  ('lab_iodo_na_urina', 'Iodo na urina', 'mcg/L', 0, 5000, 'laboratorio', 480),
  ('lab_iodo_salivar', 'Iodo salivar', 'mcg/L', 0, 10000, 'laboratorio', 490),
  ('lab_t3_livre', 'T3 livre', 'pg/mL', 0, 50, 'laboratorio', 500),
  ('lab_t3_reverso', 'T3 reverso', 'ng/mL', 0, 5, 'laboratorio', 510),
  ('lab_t3_total', 'T3 total', 'ng/dL', 0, 2000, 'laboratorio', 520),
  ('lab_t4_livre', 'T4 livre (tiroxina livre)', 'ng/dL', 0, 20, 'laboratorio', 530),
  ('lab_tireoglobulina', 'Tireoglobulina', 'ng/mL', 0, 200, 'laboratorio', 540),
  ('lab_tsh', 'TSH', 'mUI/L', 0, 50, 'laboratorio', 550),
  ('lab_cortisol', 'Cortisol', 'nmol/L', 0, 500, 'laboratorio', 560),
  ('lab_dht', 'DHT', 'pg/mL', 0, 10000, 'laboratorio', 570),
  ('lab_estradiol', 'Estradiol', 'ng/dL', 0, 500, 'laboratorio', 580),
  ('lab_fsh', 'FSH', 'mIU/mL', 0, 100, 'laboratorio', 590),
  ('lab_lh', 'LH', 'mIU/mL', 0, 100, 'laboratorio', 600),
  ('lab_progesterona', 'Progesterona', 'ng/mL', 0, 100, 'laboratorio', 610),
  ('lab_sdhea', 'SDHEA', 'mcg/dL', 0, 2000, 'laboratorio', 620),
  ('lab_shbg', 'SHBG', 'nmol/L', 0, 1000, 'laboratorio', 630),
  ('lab_t4_total', 'T4 total', 'mcg/dL', 0, 200, 'laboratorio', 640),
  ('lab_testosterona_total', 'Testosterona total', 'ng/dL', 0, 5000, 'laboratorio', 650),
  ('lab_calcio_total', 'Cálcio total', 'mg/dL', 0, 200, 'laboratorio', 660),
  ('lab_cobre', 'Cobre', 'mcg/dL', 0, 2000, 'laboratorio', 670),
  ('lab_fosforo', 'Fósforo', 'mg/dL', 0, 50, 'laboratorio', 680),
  ('lab_pth', 'Paratormônio (PTH)', 'pg/mL', 0, 500, 'laboratorio', 690),
  ('lab_vitamina_d', 'Vitamina D (25-OH)', 'ng/mL', 0, 1000, 'laboratorio', 700),
  ('lab_magnesio', 'Magnésio', 'mg/dL', 0, 50, 'laboratorio', 710),
  ('lab_manganes', 'Manganês', 'mcg/dL', 0, 500, 'laboratorio', 720),
  ('lab_potassio', 'Potássio', 'mEq/L', 0, 50, 'laboratorio', 730),
  ('lab_sodio', 'Sódio', 'mEq/L', 0, 2000, 'laboratorio', 740),
  ('lab_zinco', 'Zinco', 'mg/L', 0, 100, 'laboratorio', 750),
  ('lab_acido_folico', 'Ácido fólico', 'ng/mL', 0, 200, 'laboratorio', 760),
  ('lab_acido_metilmalonico', 'Ácido metilmalônico', 'mmol/L', 0, 5000, 'laboratorio', 770),
  ('lab_vitamina_b12', 'Vitamina B12', 'pg/mL', 0, 10000, 'laboratorio', 780),
  ('lab_betacaroteno', 'Betacaroteno', 'mcg/dL', 0, 10000, 'laboratorio', 790),
  ('lab_selenio', 'Selênio', 'mcg/L', 0, 2000, 'laboratorio', 800),
  ('lab_vitamina_a', 'Vitamina A (retinol)', 'mg/L', 0, 10, 'laboratorio', 810),
  ('lab_vitamina_c', 'Vitamina C', 'mg/dL', 0, 10, 'laboratorio', 820),
  ('lab_vitamina_e', 'Vitamina E', 'mg/L', 0, 200, 'laboratorio', 830),
  ('lab_calcio_urinario', 'Cálcio urinário', 'mg/24h', 0, 5000, 'laboratorio', 840),
  ('lab_creatinina_urinaria', 'Creatinina urinária', 'mg/24h', 0, 20000, 'laboratorio', 850)
ON CONFLICT (metric_type) DO NOTHING;

-- =========================================================================
-- 3. Gotcha 0170: `test_truncate_all_mutable` (chamado por resetDatabase())
--    TRUNCA patient_metric_types e restaura do snapshot catalog_baseline. Sem
--    este refresh, os exames somem a cada `vitest` num DB local cujo baseline
--    foi capturado antes desta migration. Em DB fresco (CI) o baseline é
--    capturado depois de todas as migrations e já os inclui.
-- =========================================================================
DO $$ BEGIN
  IF to_regclass('catalog_baseline.patient_metric_types') IS NOT NULL THEN
    INSERT INTO catalog_baseline.patient_metric_types
    SELECT p.* FROM public.patient_metric_types p
    WHERE p.metric_type IN ('lab_homa_beta', 'lab_insulina', 'lab_proinsulina', 'lab_apo_a1', 'lab_apo_b', 'lab_adiponectina', 'lab_coenzima_q10', 'lab_homocisteina', 'lab_ldl_oxidado', 'lab_lp_pla2', 'lab_lipoproteina_a', 'lab_mieloperoxidase', 'lab_pcr_us', 'lab_basofilos', 'lab_chcm', 'lab_eosinofilos', 'lab_fibrinogenio', 'lab_hcm', 'lab_hemacias', 'lab_hematocrito', 'lab_hemoglobina', 'lab_holotranscobalamina', 'lab_leucocitos', 'lab_linfocitos', 'lab_monocitos', 'lab_neutrofilos', 'lab_plaquetas', 'lab_rdw', 'lab_vcm', 'lab_vsg', 'lab_ferritina', 'lab_saturacao_transferrina', 'lab_bilirrubina_direta', 'lab_bilirrubina_indireta', 'lab_bilirrubina_total', 'lab_fosfatase_alcalina', 'lab_ggt', 'lab_tgo', 'lab_tgp', 'lab_acido_urico', 'lab_calcio_ionico', 'lab_ureia', 'lab_iodo_na_urina', 'lab_iodo_salivar', 'lab_t3_livre', 'lab_t3_reverso', 'lab_t3_total', 'lab_t4_livre', 'lab_tireoglobulina', 'lab_tsh', 'lab_cortisol', 'lab_dht', 'lab_estradiol', 'lab_fsh', 'lab_lh', 'lab_progesterona', 'lab_sdhea', 'lab_shbg', 'lab_t4_total', 'lab_testosterona_total', 'lab_calcio_total', 'lab_cobre', 'lab_fosforo', 'lab_pth', 'lab_vitamina_d', 'lab_magnesio', 'lab_manganes', 'lab_potassio', 'lab_sodio', 'lab_zinco', 'lab_acido_folico', 'lab_acido_metilmalonico', 'lab_vitamina_b12', 'lab_betacaroteno', 'lab_selenio', 'lab_vitamina_a', 'lab_vitamina_c', 'lab_vitamina_e', 'lab_calcio_urinario', 'lab_creatinina_urinaria')
      AND NOT EXISTS (
        SELECT 1 FROM catalog_baseline.patient_metric_types b
        WHERE b.metric_type = p.metric_type
      );
  END IF;
END $$;
