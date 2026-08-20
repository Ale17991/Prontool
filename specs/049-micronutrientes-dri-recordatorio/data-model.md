# Data Model — 049 Micronutrientes, DRIs, Adequação e Recordatório

Migrations novas a partir do próximo número livre após `0180`. Padrões: RLS por `tenant_id`; catálogos globais `tenant_id IS NULL`; `log_audit_event` nas escritas; `catalog_baseline` atualizado para dados globais novos (gotcha 0170).

## 1. Micronutrientes no alimento (US1)

### `public.foods` — ALTER (aditivo)

- `micronutrients JSONB NULL` — mapa `nutrient_key → valor por reference_grams`. Ex.: `{"calcio_mg": 8, "ferro_mg": 2.81, "vitamina_c_mg": 0, ...}`. Chaves ausentes = dado desconhecido (não zero).
- `source` (já existe) ganha valor novo para a origem AF (ex.: `af_bdalimentos`).

### Catálogo TS `micronutrients.ts` (não é tabela)

Lista canônica dos ~37 micros: `{ key, label, unit, driKey? }`. Ex.: `{ key:'calcio_mg', label:'Cálcio', unit:'mg', driKey:'calcio' }`. Fonte das chaves = colunas da `BD ALIMENTOS`. Usado por: soma (iterar chaves), exibição (label+unidade), ligação com DRI (`driKey`).

### Snapshot da prescrição (047)

A prescrição imutável (`diet_plan_prescriptions.snapshot`) passa a poder incluir micros nos totais congelados (aditivo ao JSONB existente; planos antigos sem micros seguem válidos).

## 2. DRIs (US2)

### `public.dietary_reference_intakes` — NOVA (global)

| Coluna          | Tipo                           | Notas                                                                |
| --------------- | ------------------------------ | -------------------------------------------------------------------- |
| `id`            | UUID PK                        |                                                                      |
| `nutrient_key`  | TEXT NOT NULL                  | casa com `driKey` do catálogo (ex.: `ferro`, `calcio`, `vitamina_c`) |
| `sex`           | TEXT NOT NULL                  | `M` / `F` / `any`                                                    |
| `age_min_years` | NUMERIC NOT NULL               | inclusive                                                            |
| `age_max_years` | NUMERIC NOT NULL               | inclusive (ex.: 130 = sem teto)                                      |
| `state`         | TEXT NOT NULL DEFAULT `padrao` | `padrao` / `gestante` / `lactante`                                   |
| `value`         | NUMERIC NOT NULL               | recomendação                                                         |
| `unit`          | TEXT NOT NULL                  | mg / mcg / g                                                         |
| `source_label`  | TEXT NULL                      | fonte/versão da referência                                           |

- `tenant_id` **ausente** (catálogo global). RLS: SELECT para `authenticated`; sem escrita pela clínica.
- UNIQUE `(nutrient_key, sex, age_min_years, age_max_years, state)`.
- Índice `(nutrient_key, sex, state)` para o lookup por faixa.
- Registrada no `catalog_baseline` (sobrevive ao reset dos testes).
- **Seed** da `BD_DRIs` (Evonut) via script.

**Lookup** (`dri/read.ts`): dado `(nutrient_key, sex, ageYears, state)` → linha onde `age_min ≤ ageYears ≤ age_max` e `sex ∈ {informado, any}` e `state` = informado (fallback `padrao`). Sem match → sem referência.

## 3. Recordatório (US3)

### `public.food_recalls` — NOVA (por tenant)

| Coluna                      | Tipo                     | Notas                  |
| --------------------------- | ------------------------ | ---------------------- |
| `id`                        | UUID PK                  |                        |
| `tenant_id`                 | UUID NOT NULL → tenants  | RLS                    |
| `patient_id`                | UUID NOT NULL → patients |                        |
| `recall_date`               | DATE NOT NULL            | o dia recordado (R24h) |
| `notes`                     | TEXT NULL                |                        |
| `created_by_user_id`        | UUID NULL                |                        |
| `created_at` / `updated_at` | TIMESTAMPTZ              |                        |

### `public.food_recall_items` — NOVA (por tenant)

| Coluna          | Tipo                                           | Notas                 |
| --------------- | ---------------------------------------------- | --------------------- |
| `id`            | UUID PK                                        |                       |
| `recall_id`     | UUID NOT NULL → food_recalls ON DELETE CASCADE |                       |
| `tenant_id`     | UUID NOT NULL                                  | RLS + consistência    |
| `meal_name`     | TEXT NOT NULL                                  | ex.: "Café da manhã"  |
| `position`      | INT NOT NULL                                   | ordem                 |
| `food_id`       | UUID NOT NULL → foods                          |                       |
| `grams`         | NUMERIC NULL                                   | ou via medida caseira |
| `measure_label` | TEXT NULL                                      | medida caseira        |
| `measure_qty`   | NUMERIC NULL                                   |                       |

- RLS: leitura/escrita `tenant_id = jwt_tenant_id()` e papéis `admin`/`profissional_saude`.
- Sem prescrição/snapshot (recordatório é editável; um dia). Auditoria via `log_audit_event`.

## 4. Motor (tipos, não tabelas)

- `Nutrients` (diet/totals) ganha `micros: Record<string, number>` (chaves do catálogo). `FoodRef` ganha `micros`. `itemNutrients` escala micros por regra de três.
- `AdequacyResult`: `{ nutrientKey, label, unit, total, dri: number|null, pct: number|null, class: 'abaixo'|'adequado'|'acima'|'sem_referencia' }[]` + resumo (nº carências/excessos).

## Entidades e relações (resumo)

- **Alimento** (`foods`) 1—\* micros (JSONB inline). Global ou por tenant.
- **DRI** (`dietary_reference_intakes`) — catálogo global; ligado ao alimento só via `nutrient_key`/`driKey` na análise (não FK).
- **Recordatório** (`food_recalls`) 1—_ **itens** (`food_recall_items`) _—1 **Alimento**. Por tenant, ligado a **Paciente**.
- **Análise de adequação** — derivada (não persistida): cruza totais (plano ou recordatório) × DRI da faixa do **Paciente** (idade/sexo/estado).
