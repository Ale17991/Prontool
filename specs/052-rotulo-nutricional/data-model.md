# Data Model — 052 Rótulo Nutricional

Migration nova: **`0186_nutrition_labels.sql`** (a última é a `0185` da feature 051).

Padrões herdados: `tenant_id` + RLS em tudo que é da clínica; `log_audit_event` nas escritas; nada de catálogo global novo (research D2).

## 1. `public.nutrition_labels` — NOVA (por tenant)

| Coluna | Tipo | Notas |
|---|---|---|
| `id` | UUID PK | |
| `tenant_id` | UUID NOT NULL → tenants | RLS |
| `product_name` | TEXT NOT NULL | nome do produto |
| `client_name` | TEXT NULL | cliente da clínica (texto livre — sem entidade nova, research D7) |
| `basis` | TEXT NOT NULL CHECK (`solido`,`liquido`) | define 100 g vs 100 mL e os limites da lupa |
| `total_yield` | NUMERIC(10,2) NOT NULL CHECK > 0 | rendimento total, **informado** (research D6) |
| `portion_size` | NUMERIC(10,2) NOT NULL CHECK > 0 | tamanho da porção |
| `household_measure` | TEXT NULL | "1 fatia", "1 copo" |
| `portions_per_package` | NUMERIC(8,2) NULL | |
| `ingredients_text` | TEXT NULL | lista de ingredientes do rótulo |
| `allergens_text` | TEXT NULL | "ALÉRGICOS: CONTÉM…" |
| `storage_text` | TEXT NULL | conservação |
| `manual_values` | JSONB NOT NULL DEFAULT `'{}'` | sobrescritas: `nutrient_key → valor` (US2) |
| `normative_version` | TEXT NOT NULL | versão da norma usada no cálculo (FR-021) |
| `created_by_user_id` | UUID NULL | |
| `created_at` / `updated_at` | TIMESTAMPTZ | `touch_updated_at` |

- `CHECK (portion_size <= total_yield)` — a porção não pode ser maior que o rendimento (edge case do spec).
- Índice `(tenant_id, updated_at DESC)` para a listagem.
- RLS: SELECT same-tenant; escrita `tenant_id = jwt_tenant_id() AND jwt_role() IN ('admin','profissional_saude')`.
- **Editável** (não é append-only): é rascunho de trabalho, não histórico contábil.

**Por que `manual_values` é JSONB e não tabela**: são no máximo 10 chaves (os nutrientes obrigatórios), sempre lidas junto com o rótulo, nunca consultadas isoladamente. Mesma escolha de `foods.micronutrients` (049) e `diet_meal_items.group_options` (0180).

## 2. `public.nutrition_label_ingredients` — NOVA (por tenant)

| Coluna | Tipo | Notas |
|---|---|---|
| `id` | UUID PK | |
| `label_id` | UUID NOT NULL → nutrition_labels ON DELETE CASCADE | |
| `tenant_id` | UUID NOT NULL → tenants | RLS + consistência |
| `food_id` | UUID NOT NULL → foods | global ou próprio da clínica |
| `grams` | NUMERIC(10,2) NOT NULL CHECK > 0 | quanto entra no preparo |
| `position` | INT NOT NULL DEFAULT 0 | ordem de exibição |

- Índice `(label_id, position)`.
- Mesma RLS da tabela pai.

## 3. Referências normativas — **código, não tabela** (research D2)

`src/lib/core/nutrition/labeling/reference.ts`:

```ts
export const NORMATIVE_VERSION = 'IN 75/2020 + RDC 429/2020'

export interface LabelNutrientDef {
  key: string          // chave interna
  label: string        // "Gorduras saturadas"
  unit: 'kcal' | 'g' | 'mg'
  /** VDR do Anexo II. null = a norma não estabelece %VD (açúcares totais). */
  dv: number | null
  /** Limite do Anexo IV abaixo do qual se declara 0. */
  insignificantBelow: number
  /** De onde sai o valor na base de alimentos. */
  source: 'energy' | 'carb' | 'protein' | 'fat' | 'fiber' | { micro: string }
  order: number
}

export const LABEL_NUTRIENTS: readonly LabelNutrientDef[]   // os 10 obrigatórios, na ordem da norma

export const FRONT_OF_PACK = {
  acucar_adicionado: { solido: 15,  liquido: 7.5 },   // g / 100
  gordura_saturada:  { solido: 6,   liquido: 3    },   // g / 100
  sodio:             { solido: 600, liquido: 300  },   // mg / 100
} as const
```

Valores concretos e fontes em `research.md` D1. **Tarefa bloqueante antes do merge**: conferir cada número contra o texto oficial da ANVISA — é dado que vai para embalagem comercial.

## 4. Tipos derivados (não persistidos)

```ts
type ValueState = 'calculado' | 'incompleto' | 'sobrescrito'

interface LabelNutrientRow {
  key: string
  label: string
  unit: string
  per100: number | null        // null quando incompleto
  perPortion: number | null
  dvPercent: number | null     // null quando não há VDR ou está incompleto
  state: ValueState
  /** Nomes dos ingredientes sem o dado — só quando state = 'incompleto'. */
  missingFrom: string[]
}

type FrontOfPackVerdict = 'aplica' | 'nao_aplica' | 'inconclusivo'

interface LabelResult {
  rows: LabelNutrientRow[]
  frontOfPack: Record<'acucar_adicionado' | 'gordura_saturada' | 'sodio', FrontOfPackVerdict>
  /** true se algum nutriente obrigatório está incompleto — bloqueia uso na embalagem. */
  incomplete: boolean
  normativeVersion: string
}
```

A tabela do rótulo é **derivada, nunca persistida**: recalculável a partir dos ingredientes + sobrescritas + referências. Corrigir a base de alimentos ou a norma reflete no rótulo sem reescrever registro.

## 5. Os quatro estados de um valor

| Estado | Origem | Exibição |
|---|---|---|
| **Calculado** | todos os ingredientes têm o dado | valor arredondado pela norma |
| **Incompleto** | ao menos um ingrediente sem o dado | marcado + lista de quais faltam; **nunca 0** |
| **Sobrescrito** | informado pela nutricionista (`manual_values`) | valor com marca de origem, desfazível |
| **Zero declarado** | calculado e abaixo do Anexo IV | `0` — que é a declaração correta |

Distinguir "não sei" de "é zero" é o requisito central da feature (FR-010, SC-004).

## 6. Arredondamento — só na apresentação

`rounding.ts` aplica Anexos III e IV **na hora de exibir ou imprimir**. Os valores brutos (full precision) circulam no motor e nunca são gravados arredondados — arredondar antes de somar propaga erro, e arredondar antes de gravar torna o dado irrecuperável.

## Entidades e relações (resumo)

- **Rótulo** (`nutrition_labels`) 1—* **Ingredientes** (`nutrition_label_ingredients`) *—1 **Alimento** (`foods`). Por tenant.
- **Sobrescritas** — JSONB inline no rótulo.
- **Referências normativas** — constantes de código, versionadas em git; a versão usada fica gravada no rótulo.
- **Resultado do rótulo** — derivado: ingredientes × referências × sobrescritas.
- **Nenhum vínculo com paciente** (research D7).
