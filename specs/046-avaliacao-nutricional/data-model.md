# Data Model — Avaliação Nutricional (046)

Migration nova: **`0175_nutrition_assessments.sql`**. Reuso de tabelas da feature 030.

## Entidade nova: `public.nutrition_assessments` (append-only)

O retrato imutável de uma avaliação. Um paciente tem N avaliações ao longo do tempo.

| Coluna                 | Tipo                                                 | Notas                                                                                                                            |
| ---------------------- | ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `id`                   | UUID PK                                              | `gen_random_uuid()`                                                                                                              |
| `tenant_id`            | UUID NOT NULL → `tenants`                            | RLS por `jwt_tenant_id()`                                                                                                        |
| `patient_id`           | UUID NOT NULL → `patients`                           | escopo do paciente                                                                                                               |
| `assessed_at`          | DATE NOT NULL                                        | data da avaliação (também `measured_at` dos derivados)                                                                           |
| `sex`                  | TEXT NOT NULL CHECK (`'M'`/`'F'`)                    | congelado no momento (vem do paciente)                                                                                           |
| `age_years`            | INTEGER NOT NULL CHECK (0–120)                       | idade na avaliação (congelada)                                                                                                   |
| `weight_kg`            | NUMERIC NOT NULL CHECK (2–400)                       |                                                                                                                                  |
| `height_cm`            | NUMERIC NULL CHECK (30–260)                          | necessário p/ IMC e algumas equações                                                                                             |
| `skinfolds`            | JSONB NOT NULL DEFAULT `'{}'`                        | mapa sítio→mm: `triceps, biceps, subescapular, suprailiaca, peitoral, axilar_media, abdominal, coxa, panturrilha, supraespinhal` |
| `circumferences`       | JSONB NOT NULL DEFAULT `'{}'`                        | mapa: `cintura, quadril, braco, panturrilha, pescoco` (cm)                                                                       |
| `dobra_protocol`       | TEXT NULL                                            | `durnin_womersley\|guedes\|jp3\|jp7\|petroski\|faulkner\|weltman\|mcardle\|slaughter\|bioimpedancia`                             |
| `body_density`         | NUMERIC NULL                                         | Dc calculado                                                                                                                     |
| `fat_pct`              | NUMERIC NULL CHECK (1–70)                            | %gordura (Siri) ou entrada direta (bioimpedância)                                                                                |
| `fat_mass_kg`          | NUMERIC NULL                                         | = peso × %gordura                                                                                                                |
| `lean_mass_kg`         | NUMERIC NULL                                         | = peso − massa gorda (MLG)                                                                                                       |
| `imc`                  | NUMERIC NULL                                         |                                                                                                                                  |
| `imc_class`            | TEXT NULL                                            | classificação (OMS/idoso)                                                                                                        |
| `waist_hip_ratio`      | NUMERIC NULL                                         | RCQ                                                                                                                              |
| `waist_hip_class`      | TEXT NULL                                            | classificação de risco por sexo                                                                                                  |
| `tmb_equation`         | TEXT NULL                                            | uma das 16 (slug)                                                                                                                |
| `tmb_kcal`             | NUMERIC NULL                                         | taxa metabólica basal                                                                                                            |
| `activity_factor`      | NUMERIC NULL CHECK (1–3)                             | PAL                                                                                                                              |
| `injury_factor`        | NUMERIC NOT NULL DEFAULT 1.0 CHECK (0.5–3)           | fator injúria/estresse                                                                                                           |
| `extra_kcal`           | NUMERIC NOT NULL DEFAULT 0                           | adicional gestante/lactante                                                                                                      |
| `get_kcal`             | NUMERIC NULL                                         | gasto energético total                                                                                                           |
| `objective`            | TEXT NULL CHECK (`deficit`/`manutencao`/`superavit`) |                                                                                                                                  |
| `objective_delta_kcal` | NUMERIC NULL                                         | ajuste sobre o GET (kcal, sinal conforme objetivo)                                                                               |
| `target_kcal`          | NUMERIC NULL                                         | VET-meta                                                                                                                         |
| `target_macros`        | JSONB NULL                                           | `{prot_g, carb_g, lip_g, prot_pct, carb_pct, lip_pct}`                                                                           |
| `notes`                | TEXT NULL CHECK (≤ 2000)                             |                                                                                                                                  |
| `created_by_user_id`   | UUID NOT NULL → `auth.users`                         |                                                                                                                                  |
| `created_at`           | TIMESTAMPTZ NOT NULL DEFAULT `now()`                 |                                                                                                                                  |

**Índice**: `(tenant_id, patient_id, assessed_at DESC)`.

**RLS**:

- SELECT: `tenant_id = jwt_tenant_id()`.
- INSERT: `tenant_id = jwt_tenant_id() AND jwt_role() IN ('admin','profissional_saude')`.
- REVOKE UPDATE, DELETE de `authenticated`.

**Append-only**: trigger `BEFORE UPDATE OR DELETE` que rejeita mutação para papéis não-superuser (padrão `patient_measurements`/perio). Correção = nova avaliação.

**Auditoria**: `AFTER INSERT` → `log_audit_event(tenant, 'nutrition_assessments', id, 'created', …)`.

**Escrita via RPC** `SECURITY DEFINER` (`create_nutrition_assessment(...)`) que grava a linha **e** os derivados (abaixo) numa transação — mesmo padrão do batch de medições. (Alternativa: app-layer com `recordMeasurementsBatch`; decidir no plano de implementação — preferência pela RPC para atomicidade.)

## Derivados → `patient_measurements` (reuso, feature 030)

Ao salvar, lançar medições com `measured_at = assessed_at` (mesma sessão, atômico), reusando `recordMeasurementsBatch`:

| Métrica (`metric_type`)  | Origem                        |
| ------------------------ | ----------------------------- |
| `peso`                   | `weight_kg`                   |
| `imc`                    | `imc`                         |
| `percentual_gordura`     | `fat_pct`                     |
| `massa_gorda_kg`         | `fat_mass_kg`                 |
| `massa_magra_kg`         | `lean_mass_kg`                |
| `taxa_metabolica_basal`  | `tmb_kcal`                    |
| `gasto_energetico_total` | `get_kcal` (**métrica nova**) |

Só lança as que foram calculadas (bloco de composição ou de energia pode faltar).

## Catálogo: nova métrica em `patient_metric_types`

| metric_type              | label                  | unit | min | max  | specialty |
| ------------------------ | ---------------------- | ---- | --- | ---- | --------- |
| `gasto_energetico_total` | Gasto energético total | kcal | 500 | 8000 | nutricao  |

As demais (`peso`, `imc`, `percentual_gordura`, `massa_gorda_kg`, `massa_magra_kg`, `taxa_metabolica_basal`) já existem (seed de bioimpedância). **Gotcha `catalog_baseline` (0170)**: inserir a métrica também no baseline para sobreviver ao reset dos testes.

## Reuso: `patient_metric_goals` (metas)

Peso-alvo e %gordura-alvo do paciente. Sem schema novo — apenas uso.

## Relações

```
patients 1───N nutrition_assessments
nutrition_assessments ──(ao salvar)──> patient_measurements (N derivados por avaliação)
patient_metric_types 1───N patient_measurements (metric_type FK)
patients 1───N patient_metric_goals
```

## Regras de validação (motor + banco)

- `sex` e `age_years` obrigatórios (equações/protocolos dependem). Faltando → erro orientando completar cadastro.
- Protocolo de dobras exige os sítios daquele protocolo em `skinfolds`; faltando → não calcula composição.
- Equações por massa magra (Katch-McArdle, Cunningham, Tinsley-MLG) exigem `lean_mass_kg` (da composição).
- Faixas plausíveis (CHECK no banco + validação no motor) barram erro de digitação.
- `target_macros`: percentuais somam 100% quando informados por %.
- Compatibilidade protocolo↔idade (ex.: Slaughter 7–18; McArdle 9–16) avisada.
