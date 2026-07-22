# Data Model — Plano Alimentar (047)

**Migration**: `0176_food_catalog_and_diet_plan.sql`
**Princípios tocados**: I (imutabilidade da prescrição), II (auditoria), III (multi-tenant), V (RBAC).

Convenções do projeto seguidas aqui: PK `UUID`, `tenant_id` obrigatório em dado de clínica, timestamps `TIMESTAMPTZ` em UTC, RLS por `jwt_tenant_id()`, append-only via trigger + `REVOKE`, auditoria via `log_audit_event`.

> **Nutrientes em `NUMERIC`, nunca `float`.** Mesma razão pela qual a constituição exige centavos inteiros em dinheiro: soma de ponto flutuante acumula erro, e o SC-002 exige que o total do dia confira exatamente com a soma dos itens.

---

## 1. `food_groups` — grupos alimentares

Catálogo **global somente-leitura** (proteínas, carboidratos, frutas, gorduras, laticínios, leguminosas…). Sem `tenant_id`: o conjunto de grupos é estável e compartilhado; o que varia por clínica são os alimentos e as listas de substituição.

| Coluna | Tipo | Notas |
|---|---|---|
| `id` | UUID PK | |
| `slug` | TEXT UNIQUE NOT NULL | `proteinas`, `frutas`… — chave estável para seed idempotente |
| `label` | TEXT NOT NULL | exibição |
| `display_order` | INT NOT NULL DEFAULT 0 | ordem na UI |
| `active` | BOOLEAN NOT NULL DEFAULT TRUE | |

**RLS**: SELECT liberado a `authenticated`. Sem INSERT/UPDATE/DELETE para `authenticated` (só service role, via seed).

---

## 2. `foods` — alimentos

O coração da feature. Segue **exatamente** o padrão da migration 0123 (`patient_metric_types`): `tenant_id NULL` = linha global do catálogo; `tenant_id` setado = alimento próprio da clínica.

| Coluna | Tipo | Notas |
|---|---|---|
| `id` | UUID PK | |
| `tenant_id` | UUID NULL REFERENCES tenants | **NULL = global somente-leitura** |
| `source` | TEXT NOT NULL | `taco` \| `tbca` \| `ibge_pof` \| `custom` — proveniência (ver research D1) |
| `external_code` | TEXT NULL | código do alimento na base de origem; permite re-seed idempotente e rastrear atualização da tabela oficial |
| `name` | TEXT NOT NULL | CHECK length 1..200 |
| `group_id` | UUID NULL REFERENCES food_groups | nullable: alimento próprio pode nascer sem grupo |
| `reference_grams` | NUMERIC(8,2) NOT NULL DEFAULT 100 | porção de referência dos valores abaixo |
| `energy_kcal` | NUMERIC(8,2) NOT NULL | ver FR-007 (derivada dos macros se ausente) |
| `protein_g` | NUMERIC(8,2) NOT NULL DEFAULT 0 | |
| `carb_g` | NUMERIC(8,2) NOT NULL DEFAULT 0 | |
| `fat_g` | NUMERIC(8,2) NOT NULL DEFAULT 0 | |
| `fiber_g` | NUMERIC(8,2) NULL | opcional |
| `micros` | JSONB NOT NULL DEFAULT '{}' | micronutrientes opcionais (FR-006). Fora do cálculo v1 |
| `active` | BOOLEAN NOT NULL DEFAULT TRUE | desativar ≠ apagar (FR-017/SC-004) |
| `created_at` / `updated_at` | TIMESTAMPTZ | |
| `created_by_user_id` | UUID NULL REFERENCES auth.users | NULL nas linhas globais (vêm do seed) |

**Índices**
- `(tenant_id, active, name)` — listagem.
- **Busca textual**: índice GIN sobre `unaccent(lower(name))` com `pg_trgm`, para typeahead tolerante a acento e a erro de digitação sobre milhares de itens. *(Confirmar disponibilidade de `pg_trgm`/`unaccent` no Supabase local — item de research.)*
- `UNIQUE (source, external_code) WHERE tenant_id IS NULL` — idempotência do seed global.

**CHECKs de plausibilidade (FR-019)** — anti-erro de digitação, não julgamento nutricional:
- `energy_kcal BETWEEN 0 AND 1000` por 100 g (óleo puro ≈ 884).
- `protein_g`, `carb_g`, `fat_g`, `fiber_g` cada um `BETWEEN 0 AND 100` por 100 g.
- `reference_grams > 0`.

**RLS** (padrão 0123)
- SELECT: `tenant_id IS NULL OR tenant_id = jwt_tenant_id()`
- INSERT/UPDATE/DELETE: `tenant_id = jwt_tenant_id() AND jwt_role() IN ('admin','profissional_saude')`
- Trigger **anti-escrita nas linhas globais** (`WHEN (OLD.tenant_id IS NULL)`), espelhando a 0123.

**Auditoria**: `log_audit_event` em INSERT/UPDATE/DELETE de linha com `tenant_id` não-nulo (FR-018).

---

## 3. `food_household_measures` — medidas caseiras

1:N com `foods`. Necessária para o FR-008/FR-012 ("1 colher de sopa = 25 g").

| Coluna | Tipo | Notas |
|---|---|---|
| `id` | UUID PK | |
| `food_id` | UUID NOT NULL REFERENCES foods ON DELETE CASCADE | |
| `tenant_id` | UUID NULL | espelha o do alimento (NULL = global); simplifica a RLS |
| `label` | TEXT NOT NULL | "colher de sopa", "unidade média", "fatia" |
| `grams` | NUMERIC(8,2) NOT NULL CHECK (grams > 0) | equivalência |
| `is_default` | BOOLEAN NOT NULL DEFAULT FALSE | medida sugerida na UI |

**RLS**: mesma regra de `foods`.

---

## 4. `food_equivalence_lists` + `food_equivalence_items` — substituições (US3)

O "OU" das planilhas: dentro de um grupo, alimentos que se equivalem numa porção de referência.

**`food_equivalence_lists`**

| Coluna | Tipo | Notas |
|---|---|---|
| `id` | UUID PK | |
| `tenant_id` | UUID NULL | NULL = lista global de fábrica; setado = lista da clínica |
| `group_id` | UUID NOT NULL REFERENCES food_groups | |
| `name` | TEXT NOT NULL | "Carboidratos — 1 porção (≈80 kcal)" |
| `reference_kcal` | NUMERIC(8,2) NULL | energia da porção equivalente (FR-015) |
| `active` | BOOLEAN NOT NULL DEFAULT TRUE | |

**`food_equivalence_items`**

| Coluna | Tipo | Notas |
|---|---|---|
| `id` | UUID PK | |
| `list_id` | UUID NOT NULL REFERENCES food_equivalence_lists ON DELETE CASCADE | |
| `tenant_id` | UUID NULL | espelha a lista |
| `food_id` | UUID NOT NULL REFERENCES foods | |
| `grams` | NUMERIC(8,2) NOT NULL | quanto deste alimento equivale a 1 porção da lista |

**RLS**: mesma regra de `foods` (global legível por todos, custom só da clínica).

---

## 5. `diet_plans` — ESTENDER (existe desde a 0122)

Hoje: `id, tenant_id, patient_id, title, notes, active, created_at, updated_at, created_by_user_id`, com `UNIQUE (tenant_id, patient_id) WHERE active`.

**Colunas novas (todas nullable//com default → aditivo, sem quebrar dado existente):**

| Coluna | Tipo | Notas |
|---|---|---|
| `status` | TEXT NOT NULL DEFAULT `'rascunho'` | `rascunho` \| `prescrito`. Os planos legados nascem como `rascunho` |
| `assessment_id` | UUID NULL REFERENCES nutrition_assessments | avaliação de onde veio a meta (046); NULL = plano sem meta (edge case previsto) |
| `target_kcal` | NUMERIC(8,2) NULL | meta congelada no plano (cópia de `nutrition_assessments.target_kcal`) |
| `target_macros` | JSONB NULL | idem `target_macros` |

> **Por que copiar a meta em vez de só referenciar a avaliação:** a comparação plano×meta precisa ser estável. Se a nutricionista fizer uma nova avaliação depois, o plano já prescrito não pode mudar de meta retroativamente — mesmo raciocínio do congelamento de nutrientes (FR-017).

---

## 6. `diet_meal_items` — ESTENDER (existe desde a 0122)

Hoje: `id, tenant_id, meal_id, position, food TEXT, quantity TEXT, notes, created_at`. O `food`/`quantity` são **texto livre** — é o que impede qualquer cálculo hoje.

**Colunas novas (aditivas):**

| Coluna | Tipo | Notas |
|---|---|---|
| `food_id` | UUID NULL REFERENCES foods | NULL = item legado de texto livre (retrocompatível) |
| `grams` | NUMERIC(8,2) NULL CHECK (grams > 0) | quantidade normalizada — **é sobre ela que o cálculo roda** |
| `measure_label` | TEXT NULL | medida caseira escolhida ("colher de sopa") |
| `measure_qty` | NUMERIC(8,2) NULL | quantas medidas (2 colheres) |
| `equivalence_list_id` | UUID NULL REFERENCES food_equivalence_lists | se preenchido, o item aceita substituições desta lista (US3) |
| **snapshot congelado** | | preenchido **na prescrição** (FR-017) |
| `snap_energy_kcal` | NUMERIC(8,2) NULL | |
| `snap_protein_g` | NUMERIC(8,2) NULL | |
| `snap_carb_g` | NUMERIC(8,2) NULL | |
| `snap_fat_g` | NUMERIC(8,2) NULL | |
| `snap_fiber_g` | NUMERIC(8,2) NULL | |

**Regra de leitura**: item com `snap_*` preenchido usa o snapshot; item em rascunho calcula ao vivo a partir de `foods`. É isso que faz o SC-004 passar — editar a base não mexe em plano prescrito.

**Nota de compatibilidade**: o `food TEXT` continua NOT NULL. Para itens novos vindos do catálogo, gravamos nele o **nome do alimento no momento** — assim o item permanece legível mesmo que o alimento seja desativado, e nenhuma tela legada quebra.

---

## 7. `diet_plan_prescriptions` — NOVA, append-only

O retrato imutável (FR-013, SC-007). É a fonte da verdade do que o paciente vê no portal.

| Coluna | Tipo | Notas |
|---|---|---|
| `id` | UUID PK | |
| `tenant_id` | UUID NOT NULL REFERENCES tenants | |
| `patient_id` | UUID NOT NULL REFERENCES patients | |
| `plan_id` | UUID NOT NULL REFERENCES diet_plans | plano de origem |
| `prescribed_at` | TIMESTAMPTZ NOT NULL DEFAULT now() | |
| `prescribed_by_user_id` | UUID NOT NULL REFERENCES auth.users | |
| `snapshot` | JSONB NOT NULL | **cardápio inteiro** — refeições, itens, nutrientes congelados, substituições, totais |
| `target_kcal` | NUMERIC(8,2) NULL | meta vigente na prescrição |
| `target_macros` | JSONB NULL | |
| `total_kcal` | NUMERIC(8,2) NOT NULL | total do plano (denormalizado p/ listagem) |
| `total_macros` | JSONB NOT NULL | |

**Índice**: `(tenant_id, patient_id, prescribed_at DESC)` — plano vigente = o mais recente.

**Imutabilidade (Princípio I)**
- Trigger `BEFORE UPDATE OR DELETE` → `RAISE EXCEPTION`, exceto superuser (padrão da 0175).
- `REVOKE UPDATE, DELETE ON diet_plan_prescriptions FROM authenticated`.

**RLS**
- SELECT: `tenant_id = jwt_tenant_id()`
- INSERT: `tenant_id = jwt_tenant_id() AND jwt_role() IN ('admin','profissional_saude')`

**Auditoria**: trigger `AFTER INSERT` → `log_audit_event` (FR-018).

> **Por que snapshot JSONB e não só as FKs:** o SC-007 exige que o paciente veja **exatamente** o que foi prescrito. Reconstruir o cardápio por join depende de `diet_meals`/`diet_meal_items` continuarem existindo e inalterados — mas eles são editáveis (o rascunho segue vivo para a próxima consulta). O JSONB desacopla o registro histórico do rascunho em evolução. Mesma lógica do snapshot de `nutrition_assessments` na 046.

---

## Relações

```text
food_groups ──< foods (global: tenant_id NULL | custom: tenant_id)
                 │
                 ├──< food_household_measures
                 └──< food_equivalence_items >── food_equivalence_lists >── food_groups

patients ──< diet_plans ──< diet_meals ──< diet_meal_items >── foods
                 │                              └── (snap_* congelado na prescrição)
                 ├── assessment_id ─────────> nutrition_assessments (meta VET/macros, 046)
                 └──< diet_plan_prescriptions (append-only, snapshot JSONB) ──> portal do paciente
```

## Transições de estado

```text
diet_plans.status:
  rascunho ──(prescrever)──> prescrito
     ▲                            │
     └────(editar/nova versão)────┘

Prescrever é uma OPERAÇÃO ATÔMICA que:
  1. calcula os nutrientes de cada item a partir de `foods` (motor puro)
  2. grava os snap_* em diet_meal_items
  3. copia a meta vigente da avaliação para o plano
  4. insere diet_plan_prescriptions com o snapshot JSONB
  5. marca diet_plans.status = 'prescrito'
Tudo numa transação — meio-caminho aqui geraria plano "prescrito" sem retrato.
```

## Validações (FR-019)

| Campo | Regra | Onde |
|---|---|---|
| `energy_kcal` (por 100 g) | 0–1000 | CHECK + Zod |
| macros (por 100 g) | 0–100 cada | CHECK + Zod |
| `grams` do item | > 0 e ≤ 5000 | CHECK + Zod |
| `reference_grams` | > 0 | CHECK |
| soma de macros | ≤ 100 g por 100 g de alimento | Zod (aviso, não CHECK — hidratação/arredondamento da base oficial pode estourar por pouco) |
| energia ausente | derivar por Atwater `4P + 4C + 9L` | domínio (FR-007) |
