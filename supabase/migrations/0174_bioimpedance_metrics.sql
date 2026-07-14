-- 0174 — Métricas de bioimpedância (composição corporal) para nutrição.
--
-- Reusa o motor de medições longitudinais da feature 030
-- (patient_metric_types + patient_measurements). Uma sessão de bioimpedância
-- (BIA) produz um conjunto de números longitudinais — que são apenas novas
-- linhas no catálogo global, sob a especialidade `nutricao`. Sem mudança de
-- schema (o design da 0113 previa "nova especialidade = novas linhas").
--
-- Faixas plausíveis = limites de "valor impossível/typo", NÃO faixas de
-- normalidade clínica. Tetos generosos para não bloquear extremos reais
-- (obesidade grave, atletas). A validação clínica é do profissional.
--
-- Constituição: I (catálogo global append-only, como tuss_codes). Aditiva,
-- idempotente (ON CONFLICT DO NOTHING) — supabase:reset recria.

INSERT INTO public.patient_metric_types
  (metric_type, label, unit, min_plausible, max_plausible, specialty, display_order)
VALUES
  ('peso',                  'Peso',                       'kg',     2,   400,  'nutricao', 1),
  ('imc',                   'IMC',                        'kg/m²',  8,   90,   'nutricao', 2),
  ('percentual_gordura',    'Gordura corporal',           '%',      3,   70,   'nutricao', 3),
  ('massa_gorda_kg',        'Massa gorda',                'kg',     0.3, 200,  'nutricao', 4),
  ('massa_magra_kg',        'Massa magra',                'kg',     5,   150,  'nutricao', 5),
  ('massa_muscular_kg',     'Massa muscular esquelética', 'kg',     5,   120,  'nutricao', 6),
  ('agua_corporal_pct',     'Água corporal total',        '%',      20,  80,   'nutricao', 7),
  ('gordura_visceral',      'Gordura visceral (nível)',   'nível',  1,   60,   'nutricao', 8),
  ('taxa_metabolica_basal', 'Metabolismo basal (TMB)',    'kcal',   500, 5000, 'nutricao', 9),
  ('massa_ossea_kg',        'Massa óssea',                'kg',     0.3, 8,    'nutricao', 10)
ON CONFLICT (metric_type) DO NOTHING;
