# Data Model — 050 Exames Laboratoriais

Migration nova: **`0184_lab_reference_ranges.sql`** (próximo número livre — a última é `0183_food_recalls.sql`).

Padrões herdados: catálogo global = `tenant_id` ausente + RLS read-only; dado por clínica = `tenant_id` + RLS por `jwt_tenant_id()`; `log_audit_event` nas escritas; refresh do `catalog_baseline` para catálogo que é truncado no reset dos testes (gotcha 0170).

## 1. Resultados — REUSO, sem DDL

Resultados de exame **não criam tabela**. Vão para `public.patient_measurements` (0113), tal como está:

| Coluna                                                        | Uso na 050                                      |
| ------------------------------------------------------------- | ----------------------------------------------- |
| `metric_type` → `patient_metric_types`                        | o analito (ex.: `lab_ferritina`)                |
| `value NUMERIC`                                               | o resultado                                     |
| `unit`                                                        | copiada do catálogo pelo trigger quando omitida |
| `measured_at DATE`                                            | data do exame                                   |
| `notes`                                                       | observação livre (≤2000)                        |
| `tenant_id`, `patient_id`, `created_by_user_id`, `created_at` | isolamento + autoria                            |

Garantias já existentes que a feature herda: append-only total (`enforce_append_only_columns('')` — correção = novo registro); RLS SELECT same-tenant e INSERT só `admin`/`profissional_saude`; validação anti-typo pelo trigger `validate_patient_measurement`; índice `(tenant_id, patient_id, metric_type, measured_at DESC)`.

**Um laudo com N exames** = uma chamada a `recordMeasurementsBatch` com a mesma `measured_at`: valida todas as entradas antes e faz um único INSERT — se um valor sai da faixa plausível, **nada** é gravado.

## 2. Catálogo de exames — linhas novas em `patient_metric_types`

Sem DDL. A migration insere os analitos quantitativos com `specialty = 'laboratorio'`:

```sql
INSERT INTO public.patient_metric_types
  (metric_type, label, unit, min_plausible, max_plausible, specialty, display_order)
VALUES
  ('lab_ferritina', 'Ferritina', 'mcg/L', 0, 5000, 'laboratorio', 10),
  ('lab_tsh',       'TSH',       'mUI/L', 0,  500, 'laboratorio', 11),
  …
ON CONFLICT (metric_type) DO NOTHING;
```

seguido do bloco `DO $$` que replica as linhas novas em `catalog_baseline.patient_metric_types` (padrão idêntico ao das linhas 115-129 da `0175_nutrition_assessments.sql`). **Obrigatório**: `patient_metric_types` É truncada e restaurada do baseline em `resetDatabase()`; sem o refresh, os exames somem a cada `vitest`.

Regras de chave:

- Analitos novos: prefixo `lab_` + slug (`^[a-z][a-z0-9_]{1,63}$`).
- **Os 7 legados da 0113 não são reinseridos nem remarcados**: `glicemia_jejum`, `hba1c`, `colesterol_total`, `ldl`, `hdl`, `triglicerides` continuam com `specialty='endocrino'` (linhas globais são append-only). O catálogo TS os declara com a chave legada e os inclui no painel.
- Exame próprio da clínica: caminho existente `createCustomMetricType` → chave `c<tenant8>_<slug>`, `tenant_id` setado, visível só àquele tenant.

⚠️ **`min_plausible`/`max_plausible` são anti-typo, NÃO faixa de referência.** Precisam ser folgados o bastante para aceitar um resultado legitimamente muito alterado — senão o INSERT é rejeitado com `MEASUREMENT_OUT_OF_RANGE` (422) justamente no caso clínico que mais importa. Regra de dimensionamento do seed: `min_plausible = 0` (ou negativo onde fizer sentido) e `max_plausible ≥ 10× o limite superior de referência`.

## 3. `public.lab_reference_ranges` — NOVA (global)

| Coluna          | Tipo                                                                     | Notas                                   |
| --------------- | ------------------------------------------------------------------------ | --------------------------------------- |
| `id`            | UUID PK DEFAULT `gen_random_uuid()`                                      |                                         |
| `analyte_key`   | TEXT NOT NULL                                                            | casa com `metric_type` do catálogo      |
| `sex`           | TEXT NOT NULL CHECK IN (`M`,`F`,`any`)                                   | `any` = mesma faixa para ambos          |
| `age_min_years` | NUMERIC(6,2) NOT NULL                                                    | inclusive                               |
| `age_max_years` | NUMERIC(6,2) NOT NULL                                                    | inclusive (130 = sem teto)              |
| `state`         | TEXT NOT NULL DEFAULT `padrao` CHECK IN (`padrao`,`gestante`,`lactante`) |                                         |
| `ref_min`       | NUMERIC(14,4) **NULL**                                                   | piso; NULL = sem piso                   |
| `ref_max`       | NUMERIC(14,4) **NULL**                                                   | teto; NULL = sem teto                   |
| `unit`          | TEXT NOT NULL                                                            | precisa bater com a unidade do catálogo |
| `source_label`  | TEXT NULL                                                                | procedência exibida na tela             |

- **Sem `tenant_id`** — catálogo global. RLS: `SELECT TO authenticated USING (true)`; `GRANT SELECT` apenas (escrita só por service_role, via script).
- `CONSTRAINT lab_range_natural_key UNIQUE (analyte_key, sex, age_min_years, age_max_years, state)`.
- `CREATE INDEX lab_range_lookup_idx ON (analyte_key, sex, state)`.
- `CHECK (age_max_years > age_min_years)`.
- `CHECK (ref_min IS NOT NULL OR ref_max IS NOT NULL)` — linha sem nenhum limite não tem razão de existir.
- `CHECK (ref_min IS NULL OR ref_max IS NULL OR ref_max >= ref_min)`.
- **Fora do `catalog_baseline`** — mesma escolha explícita da 0182: o seed é re-executável e os testes inserem as próprias faixas (self-contained).

**Diferença de forma frente à `dietary_reference_intakes`**: lá há um `value` único (alvo, adequação em %); aqui há **dois limites absolutos e independentemente nuláveis**, porque a fonte tem 24 exames só-com-teto (LDL, triglicerídeos) e 15 só-com-piso (HDL, Apo A-I).

### Lookup (`src/lib/core/labs/reference-ranges.ts`)

```ts
listLabRangesForPatient(supabase, { ageYears, sex: 'M'|'F', state? })
  : Promise<Map<string /* analyteKey */, LabRange>>
```

Uma query com filtro amplo (`age_min ≤ idade ≤ age_max`, `sex IN (informado,'any')`, `state IN (informado,'padrao')`) e desempate em memória por score — estado informado (peso 2) > `padrao`; sexo específico (peso 1) > `any`. Cópia direta de `listDRIsForPatient` (`src/lib/core/nutrition/dri/read.ts`). Sem match → analito ausente do Map → `sem_referencia`.

## 4. Seed das faixas — `scripts/build-lab-ranges-seed.ts`

Molde: `scripts/build-dris-seed.ts`. Lê `nutri-doc/Evonut.xlsm` → aba `BD_Exames` via `ExcelJS.stream.xlsx.WorkbookReader`, header na linha 3, dados 4–322.

Mapa de colunas: `A=Cod`, `B=Desc Exame`, `C=Grupo Exame`, `D=Unidade`, `E=Ref Min H`, `F=Ref Max H`, `G=Ref Min M`, `H=Ref Max M`.

Transformação por linha:

1. Descarta se não houver unidade **ou** se `E..H` estiverem todas vazias (os ~204 qualitativos) e se `Grupo = 'Exames Completos'` (os 22 pseudo-painéis) — D10.
2. Normaliza a unidade: `TRIM` + tabela de aliases contra as 37 canônicas do AF (`µg/dL`→`mcg/dL`, `mcg/Ml`→`mcg/mL`, …). **Unidade desconhecida = erro**, não gravação silenciosa.
3. Resolve `analyte_key` por nome normalizado (sem acento/caixa/parênteses), consultando o catálogo TS — que mapeia legados (`glicemia_jejum`) e novos (`lab_*`). Nome não mapeado = reportado, não inventado.
4. Deduplica: mesmo analito repetido em vários grupos com faixas idênticas vira **uma** entrada (`Ácido úrico` ×3, `Potássio` ×4).
5. Emite 1 ou 2 linhas: se `(E,F) == (G,H)` → uma linha `sex='any'`; senão → duas linhas (`M` com E/F, `F` com G/H). ~93 analitos caem no primeiro caso, ~22 no segundo.
6. `age_min_years=0`, `age_max_years=130`, `state='padrao'` para todas (D11).

Execução: `DRY=1` imprime contagens sem gravar; sem `DRY`, `createClient` service_role + `delete` + `insert` em chunks de 500 (idempotente). Scripts `pnpm seed:lab-ranges` / `:prod` no `package.json`, no padrão dos demais seeds.

## 5. Catálogo TS — `src/lib/core/labs/catalog.ts` (não é tabela)

```ts
export interface LabAnalyteDef {
  key: string // metric_type ('lab_ferritina' | legado 'hba1c')
  label: string
  unit: string
  group: string // painel: 'Hemograma', 'Perfil Lipídico', …
  aliases?: string[] // nomes alternativos (fonte: AF) p/ casar no importador
  displayOrder?: number
}
export const LAB_ANALYTES: readonly LabAnalyteDef[]
```

Fonte da verdade de **o que é exame laboratorial e em que painel aparece** — resolve o fato de os 7 legados estarem marcados `specialty='endocrino'` no banco (D2/D10). Mesmo papel de `micronutrients.ts` na 049: puro, sem I/O, usado no importador, no servidor e no cliente.

## 6. Tipos derivados (não persistidos)

```ts
type LabClass = 'baixo' | 'normal' | 'alto' | 'sem_referencia'
interface LabRange {
  refMin: number | null
  refMax: number | null
  unit: string
  sourceLabel: string | null
}
interface LabResultItem {
  analyteKey: string
  label: string
  group: string
  unit: string
  value: number
  measuredAt: string
  refMin: number | null
  refMax: number | null
  sourceLabel: string | null
  class: LabClass
}
interface LabPanelResult {
  items: LabResultItem[]
  low: number
  high: number
}
```

A classificação **nunca é gravada** — é recomputada a cada leitura a partir de resultado × faixa. Corrigir uma faixa reclassifica todo o histórico sem tocar em nenhum registro, o que preserva o append-only (Princípio I) e evita histórico com leitura obsoleta.

## 7. Portal — `sections.ts` (sem DDL)

A chave `'exames'` já existe em `PORTAL_SECTIONS` (`implemented: false`, `defaultEnabled: false`, `sensitivity: 'alta'`, `order: 60`). Mudanças: `implemented: true` + `requiredModule: 'exames_lab'`, e incluir `'exames_lab'` no union `PortalSectionModule` (hoje `'treino' | 'dieta' | 'telemedicina'`). O override por clínica (`tenant_portal_sections`) e o gate por plano já funcionam. `defaultEnabled` permanece `false` — dado sensível, a clínica opta por expor.

## Entidades e relações (resumo)

- **Analito** (`patient_metric_types`, `specialty='laboratorio'` + 7 legados) — global ou por tenant. 1—\* **Resultados**.
- **Resultado** (`patient_measurements`) _—1 **Paciente**, _—1 **Analito**. Por tenant, append-only.
- **Faixa de referência** (`lab_reference_ranges`) — catálogo global; ligada ao analito por `analyte_key` (mesma chave, **sem FK**, espelhando a escolha da 0182 e permitindo semear faixa antes/depois do catálogo).
- **Classificação** — derivada: Resultado × Faixa aplicável ao (sexo, idade, estado) do **Paciente**.
- **Paciente** — fonte de sexo e `birth_date` via `rpc('get_patient_for_tenant')`; ambos sobrescrevíveis por query param, ausência não bloqueia.
