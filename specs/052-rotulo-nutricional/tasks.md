---
description: "Task list — 052 Rótulo Nutricional"
---

# Tasks: Rótulo Nutricional de Produto

**Input**: Design documents from `/specs/052-rotulo-nutricional/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/api.md, quickstart.md

**Tests**: incluídos e **obrigatórios**. A constituição (§ Fluxo de Desenvolvimento) exige teste de isolamento entre tenants e de autorização por papel em tudo que toca acesso multi-tenant. Somam-se testes unitários do motor — aqui com peso extra: os números vão para uma **embalagem comercial**, e um erro de arredondamento ou de %VD é declaração irregular, não bug cosmético.

**Organização**: agrupadas por user story, cada uma entregável e testável isoladamente.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: paralelizável (arquivos diferentes, sem dependência pendente)
- **[Story]**: US1 / US2 / US3 / US4

## Path Conventions

Projeto único Next.js: `src/` e `tests/` na raiz; migrations em `supabase/migrations/`.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: fixar os números da norma antes de qualquer cálculo depender deles.

- [X] T001 Criar `src/lib/core/nutrition/labeling/reference.ts` com `NORMATIVE_VERSION = 'IN 75/2020 + RDC 429/2020'`, a interface `LabelNutrientDef` e a constante `LABEL_NUTRIENTS` com os **10 nutrientes obrigatórios na ordem da norma** — valor energético (kcal), carboidratos totais, açúcares totais, açúcares adicionados, proteínas, gorduras totais, gorduras saturadas, gorduras trans, fibra alimentar, sódio. Cada um com `dv` (VDR do Anexo II), `insignificantBelow` (Anexo IV), `unit` e `source` (de onde sai na base: campo direto de `foods` ou chave do JSONB de micronutrientes). Valores exatos em `research.md` D1. **Açúcares totais MUST ter `dv: null`** — a norma não estabelece VDR para eles.
- [X] T002 [P] No mesmo `reference.ts`, adicionar `FRONT_OF_PACK` com os 6 limites da RDC 429/2020 (açúcares adicionados 15 g/7,5 g · gorduras saturadas 6 g/3 g · sódio 600 mg/300 mg, por 100 g sólido / 100 mL líquido).
- [X] T003 [P] Mapear cada nutriente do rótulo para a origem real na base: energia/proteína/carboidrato/gordura/fibra são colunas de `foods`; **gorduras saturadas (`ag_saturados_g`), trans (`ag_trans_g`), açúcares totais (`acucar_total_g`) e adicionados (`acucar_adicao_g`) vêm do JSONB `micronutrients`**, importados na 049 — conferir as chaves contra `src/lib/core/nutrition/micronutrients.ts` e falhar o build se alguma não existir.
- [X] T004 [P] Teste unitário em `tests/unit/labeling-reference.spec.ts`: os 10 nutrientes presentes e sem duplicata; `order` único; toda `source` resolve para coluna existente de `foods` ou chave existente do catálogo de micronutrientes; açúcares totais com `dv: null`; nenhum outro nutriente com `dv` nulo; os 6 limites de `FRONT_OF_PACK` presentes e positivos.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: schema e as duas funções puras que todo o resto usa.

**⚠️ CRÍTICO**: nenhuma user story começa antes desta fase fechar.

- [X] T005 Criar `supabase/migrations/0187_nutrition_labels.sql` — tabela `public.nutrition_labels` conforme `data-model.md` §1: `tenant_id`, `product_name`, `client_name`, `basis` CHECK (`solido`,`liquido`), `total_yield` CHECK > 0, `portion_size` CHECK > 0, `household_measure`, `portions_per_package`, `ingredients_text`, `allergens_text`, `storage_text`, `manual_values JSONB DEFAULT '{}'`, `normative_version`, autoria e timestamps. **CHECK `portion_size <= total_yield`**. Índice `(tenant_id, updated_at DESC)`. RLS: SELECT same-tenant; escrita `admin`/`profissional_saude`. Trigger `touch_updated_at`. Idempotente.
- [X] T006 Na mesma migration, tabela `public.nutrition_label_ingredients` (`label_id` → labels ON DELETE CASCADE, `tenant_id`, `food_id` → foods, `grams` CHECK > 0, `position`), índice `(label_id, position)`, mesma RLS da tabela pai.
- [X] T007 Rodar `npx supabase migration up --local` e `pnpm supabase:gen-types` para aplicar a 0187 e regenerar `src/lib/db/generated/types.ts`.
- [X] T008 [P] Implementar `src/lib/core/nutrition/labeling/rounding.ts` — puro, sem I/O. `roundForLabel(value, unit)` aplica o **Anexo III**: ≥10 arredonda pela 1ª decimal e expressa inteiro; 1 a <10 arredonda pela 2ª decimal e expressa inteiro se a 1ª for 0, senão 1 decimal; <1 em gramas arredonda pela 2ª decimal com 1 decimal; <1 em mg/µg arredonda pela 3ª decimal, com 1 decimal se a 2ª for 0, senão 2. E `isInsignificant(value, nutrient)` aplica o **Anexo IV** (energia ≤4 kcal, carboidratos/açúcares totais/proteínas/gorduras totais/fibras ≤0,5 g, saturadas/trans ≤0,1 g, sódio ≤5 mg) → declara `0`.
- [X] T009 [P] Teste unitário em `tests/unit/labeling-rounding.spec.ts` com casos de fronteira de cada faixa do Anexo III (9,94 · 9,95 · 10,4 · 10,5 · 0,94 · 0,95) e de cada limite do Anexo IV. **Asserção central**: `isInsignificant` devolve o zero DECLARATÓRIO, que é um estado distinto de dado desconhecido — os dois nunca se confundem.

**Checkpoint**: schema aplicado e as regras da norma implementadas e testadas.

---

## Phase 3: User Story 1 - Gerar a tabela nutricional (Priority: P1) 🎯 MVP

**Goal**: montar um preparo e obter a tabela em três colunas (100 g/mL · porção · %VD) com os 10 nutrientes obrigatórios.

**Independent Test**: bolo de cenoura com 5 ingredientes, rendimento 900 g, porção 60 g; conferir que `porção = 100g × 0,6` e que `%VD = porção ÷ VDR`.

### Tests for User Story 1

- [X] T010 [P] [US1] Teste unitário do motor em `tests/unit/labeling-compose.spec.ts`: com ingredientes de dados completos, o valor por 100 g é a soma escalada pelo rendimento e o valor por porção é proporcional ao tamanho da porção; o %VD usa o VDR da norma; **açúcares totais saem com `dvPercent: null`**; rendimento menor que a soma dos ingredientes (perda por cocção) concentra os valores — um bolo de 900 g com 1000 g de ingredientes tem valores por 100 g MAIORES que a média crua.
- [X] T011 [P] [US1] Teste de contrato em `tests/contract/rotulos-route.spec.ts`: GET e POST negam `recepcionista`/`financeiro` (403) e aceitam `admin`/`profissional_saude`; módulo `nutri_rotulo` desligado → **404 `MODULE_DISABLED`** (SC-007); rótulo de outra clínica não é acessível (SC-008); `portionSize > totalYield` → 422 `PORTION_EXCEEDS_YIELD`; corpo inválido → 400 `INVALID_BODY`.

### Implementation for User Story 1

- [X] T012 [US1] Implementar `src/lib/core/nutrition/labeling/compose.ts` — puro/isomórfico. Recebe ingredientes (`{ foodId, name, grams, nutrients }`), `totalYield`, `portionSize` e `basis`; devolve `LabelResult` com `rows: LabelNutrientRow[]`. Para cada nutriente: soma o aporte de cada ingrediente por regra de três (reusando a escala de `diet/totals.ts`), divide pelo rendimento para obter por 100 g/mL, multiplica pela porção, e calcula `dvPercent` contra o `dv` de `reference.ts`. **`dvPercent` é `null` quando o nutriente não tem VDR.** Arredondamento aplicado só na saída (T008).
- [X] T013 [US1] Implementar `src/lib/core/nutrition/labeling/store.ts` — `createLabel`, `getLabel`, `listLabels`, `updateLabel`, `deleteLabel`, todos escopados por `tenantId`, gravando `normative_version` na criação e auditando via `log_audit_event`. `getLabel` carrega os ingredientes com os nutrientes dos alimentos já resolvidos, prontos para o motor.
- [X] T014 [US1] Criar `src/app/api/rotulos/route.ts` (GET lista / POST cria) conforme `contracts/api.md`: `requireRole(['admin','profissional_saude'])`, helper local de gate `nutri_rotulo` com 404 `MODULE_DISABLED` (padrão de `src/app/api/pacientes/[id]/recordatorio/route.ts`), validação Zod com `portionSize <= totalYield`, `toHttpResponse` no catch.
- [X] T015 [US1] Criar `src/app/api/rotulos/[id]/route.ts` (GET detalhe / PATCH / DELETE), devolvendo sempre o `LabelResult` recalculado junto do rótulo.
- [X] T016 [US1] Criar a tela `src/app/(dashboard)/operacao/rotulo-nutricional/page.tsx` (RSC): sessão, gate `nutri_rotulo` com redirect, checagem de papel — no molde de `src/app/(dashboard)/operacao/recordatorio/page.tsx`.
- [X] T017 [US1] Criar `src/app/(dashboard)/operacao/rotulo-nutricional/rotulo-client.tsx`: busca de ingredientes reusando `/api/alimentos`, campos de rendimento/porção/medida caseira/porções por embalagem/base sólido-líquido, e a **tabela INFORMAÇÃO NUTRICIONAL em três colunas** recalculando ao vivo no cliente (mesma função do servidor). Aviso fixo de que a responsabilidade técnica pelo rótulo é da profissional.
- [X] T018 [US1] Acrescentar o item "Rótulo Nutricional" em `src/app/(dashboard)/_components/sidebar-sections.ts`, seção Operação, gated `ent.hasModule('nutri_rotulo')` + papéis admin/profissional_saude. **Atualizar `tests/unit/dashboard-shell-sections.spec.ts`**, que hoje crava 8 itens em Operação em 3 asserções distintas (o título do teste também diz "8 items").

**Checkpoint**: US1 funcional — é o MVP, mas ainda não produz rótulo utilizável na maioria dos casos reais (ver US2).

---

## Phase 4: User Story 2 - Completar e corrigir valores à mão (Priority: P1)

**Goal**: informar ou sobrescrever qualquer nutriente, com a origem visível — e **nunca** exibir zero para dado desconhecido.

**Independent Test**: montar um preparo com um ingrediente sem açúcares adicionados; conferir que a linha aparece como incompleta (não zero), informar o valor e ver a tabela recalcular.

> **Por que isto é P1 e não melhoria**: a cobertura da base é de **7%** para açúcares adicionados e 18% para trans e açúcares totais. Sem entrada manual, a US1 não entrega rótulo utilizável na maior parte dos casos reais.

### Tests for User Story 2

- [X] T019 [P] [US2] Teste unitário em `tests/unit/labeling-completeness.spec.ts`: ingrediente sem a chave do nutriente → `state: 'incompleto'`, `per100`/`perPortion`/`dvPercent` **todos `null`** e `missingFrom` com o nome do ingrediente; **nunca `0`**. Ingrediente com o valor presente e abaixo do limite do Anexo IV → `state: 'calculado'` com valor `0` — provando que os dois zeros são distintos. Sobrescrita → `state: 'sobrescrito'` e o valor manual prevalece sobre o calculado. Remover a sobrescrita volta ao estado anterior. `incomplete: true` no resultado quando ao menos um obrigatório está incompleto.
- [X] T020 [P] [US2] Teste de integração em `tests/integration/rotulo-manual-values.spec.ts`: PATCH com `manualValues: { chave: valor }` grava e recalcula; PATCH com `manualValues: { chave: null }` remove a sobrescrita; o valor manual sobrevive a reabrir o rótulo.

### Implementation for User Story 2

- [X] T021 [US2] Estender `compose.ts` com o rastreio de completude: por nutriente, acumular quais ingredientes não tinham a chave e devolver `state` + `missingFrom`. **Ausência de chave nunca soma como zero** — o total fica indefinido, não subestimado.
- [X] T022 [US2] Aplicar `manual_values` em `compose.ts`: sobrescrita por chave tem precedência sobre o calculado e marca `state: 'sobrescrito'`. Chave com `null` no PATCH remove a sobrescrita.
- [X] T023 [US2] No `PATCH /api/rotulos/[id]`, aceitar `manualValues` como mapa parcial (`number` define, `null` remove) e persistir em `nutrition_labels.manual_values`.
- [X] T024 [US2] Na tela, marcar visualmente cada linha por estado: **incompleto** (com a lista de ingredientes faltantes e botão de informar), **sobrescrito** (com botão de desfazer) e **calculado**. Nenhum estado pode ser confundido com outro à primeira vista.

**Checkpoint**: com US1 + US2 a feature produz rótulo utilizável de verdade.

---

## Phase 5: User Story 3 - Rotulagem frontal, a "lupa" (Priority: P2)

**Goal**: indicar automaticamente se o produto é alto em açúcares adicionados, gorduras saturadas ou sódio.

**Independent Test**: subir o açúcar acima de 15 g/100 g e ver a marca aparecer; baixar e ver sumir; trocar para líquido e ver o limite mudar para 7,5 g/100 mL.

### Tests for User Story 3

- [X] T025 [P] [US3] Teste unitário em `tests/unit/labeling-front-of-pack.spec.ts`: nos três nutrientes, valor **acima** do limite → `aplica`; **exatamente no** limite → `aplica` (a norma usa "maior ou igual"); abaixo → `nao_aplica`. Limites de líquido diferem dos de sólido — a mesma composição pode se enquadrar como líquido e não como sólido. **Nutriente incompleto → `inconclusivo`, jamais `nao_aplica`.**

### Implementation for User Story 3

- [X] T026 [US3] Implementar `src/lib/core/nutrition/labeling/front-of-pack.ts` — puro: recebe os valores por 100 g/mL e a `basis`, devolve `Record<nutriente, 'aplica'|'nao_aplica'|'inconclusivo'>` comparando com `FRONT_OF_PACK`. Nutriente com `state: 'incompleto'` → `inconclusivo`.
- [X] T027 [US3] Plugar em `compose.ts` para que `LabelResult.frontOfPack` saia junto da tabela, e exibir na tela as marcas aplicáveis — com o caso `inconclusivo` redigido de forma que a profissional entenda que **falta dado**, não que o produto está liberado.

**Checkpoint**: US1, US2 e US3 funcionam independentemente.

---

## Phase 6: User Story 4 - Salvar e imprimir (Priority: P2)

**Goal**: reabrir um rótulo com tudo preservado e exportar o documento para a gráfica.

**Independent Test**: salvar, sair, reabrir e conferir que os valores informados à mão voltaram; exportar e conferir o PDF.

### Tests for User Story 4

- [X] T028 [P] [US4] Teste de integração em `tests/integration/rotulo-persistence.spec.ts`: criar um rótulo com sobrescritas, reabrir e conferir que ingredientes, rendimento, porção, textos e `manual_values` voltam idênticos, e que `normative_version` foi gravada na criação.

### Implementation for User Story 4

- [X] T029 [US4] Criar `src/lib/core/nutrition/labeling/label-pdf.tsx` (caminho ajustado: todo PDF do projeto vive em `src/lib/core/**`, não em `src/components/`) com `@react-pdf/renderer` (já em uso no projeto): tabela em três colunas no layout da norma, lista de ingredientes, alérgenos, conservação e as marcas frontais aplicáveis.
- [X] T030 [US4] **Rótulo incompleto sai marcado**: quando `result.incomplete` é `true`, o PDF traz tarja inequívoca de "não utilizável em embalagem" e lista os nutrientes pendentes (FR-018). Não existe exportação limpa de rótulo incompleto.
- [X] T031 [US4] Criar `src/app/api/rotulos/[id]/pdf/route.ts` devolvendo `application/pdf`, com o mesmo gate e RBAC das demais.
- [X] T032 [US4] Na tela, listar os rótulos salvos da clínica (com marca de quais estão incompletos) e ligar os botões de salvar, reabrir, duplicar e exportar.

**Checkpoint**: as quatro histórias funcionam independentemente.

---

## Phase 7: Polish & Cross-Cutting Concerns

- [X] T033 **CONFERÊNCIA DA NORMA — FEITA em 2026-08-02** (achou um erro real em açúcares adicionados; ver research.md). Abrir o texto oficial da ANVISA e conferir, um a um, contra `reference.ts`: os 10 VDR do Anexo II da IN 75/2020, as regras do Anexo III, as quantidades não significativas do Anexo IV e os 6 limites da RDC 429/2020. **Atenção especial ao VDR de gorduras trans (2 g nas fontes secundárias consultadas)** — a norma anterior não estabelecia valor diário para trans, então é o número com maior chance de estar errado. Registrar no `research.md` qual documento foi conferido e em que data.
- [X] T034 Rodar `pnpm typecheck`, `pnpm lint:auth` e `pnpm lint` — zero erros. `lint:auth` confirma `requireRole` nas rotas novas.
- [X] T035 Rodar a suíte completa **em lotes de ~30 arquivos** (`tests/unit`, depois `tests/contract` em 3 lotes, depois `tests/integration` em 4) — a suíte inteira de uma vez é morta pelo runner, e vitest em background não captura saída. ⚠️ `vitest` apaga o banco local: re-seedar com `pnpm seed:demo` depois.
- [X] T036 [P] Atualizar o `CLAUDE.md` com a arquitetura da 052 (a seção "Active Technologies" já foi atualizada pelo script do plano).
- [ ] T037 Executar o roteiro de `quickstart.md` ponta a ponta com o app rodando — **incluindo abrir a tela com olho humano**, que é a dívida recorrente das features de nutrição (046, 047, 049 e 050 foram a produção sem isso).
- [ ] T038 Validação com a nutricionista: gerar o rótulo de um produto real que ela já tenha rotulado e comparar linha a linha com o que foi para a embalagem.
- [X] T039 Deploy FEITO 2026-08-02 (0187 aplicada sozinha; `nutri_rotulo` já estava ligado em "Ambiente de testes"): mergear em `master` + push (a integração Supabase aplica a 0187 sozinha — **não** aplicar à mão) e ligar `nutri_rotulo` no `/admin` para as clínicas de nutrição. Se der `MIDDLEWARE_INVOCATION_FAILED`, redeploy na Vercel **sem** cache de build.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: sem dependências. T002-T004 podem correr junto de T001 depois que a interface existir.
- **Foundational (Phase 2)**: depende da Phase 1 (o arredondamento precisa saber os limites do Anexo IV, que vivem em `reference.ts`). **BLOQUEIA todas as user stories.**
- **US1 (Phase 3)**: depende da Phase 2 completa.
- **US2 (Phase 4)**: estende `compose.ts` da US1 — sequenciar após US1.
- **US3 (Phase 5)**: consome os valores por 100 g da US1 e o estado de completude da US2 (para `inconclusivo`) — sequenciar após ambas.
- **US4 (Phase 6)**: consome o `LabelResult` completo — por último.
- **Polish (Phase 7)**: depois das histórias desejadas. **T033 é bloqueante do merge, não do desenvolvimento.**

### User Story Dependencies

- **US1 (P1)**: independente. É o MVP.
- **US2 (P1)**: independentemente testável, mas estende o motor da US1. **Sem ela o v1 não é entregável** — 7% de cobertura de açúcares adicionados.
- **US3 (P2)**: precisa do estado de completude da US2 para distinguir `inconclusivo` de `nao_aplica`.
- **US4 (P2)**: precisa das três anteriores para o documento ficar completo.

### Parallel Opportunities

- T002, T003 e T004 em paralelo, depois de T001.
- T008 e T009 (arredondamento) em paralelo com T005-T007 (migration) — arquivos distintos.
- T010 e T011 (testes de US1) em paralelo.
- Os testes de cada história ([P]) sempre em paralelo entre si.

---

## Parallel Example: User Story 1

```bash
# Testes de US1 juntos:
Task: "Teste unitário do motor em tests/unit/labeling-compose.spec.ts"
Task: "Teste de contrato em tests/contract/rotulos-route.spec.ts"

# Fundação em paralelo com a migration:
Task: "Implementar src/lib/core/nutrition/labeling/rounding.ts"
Task: "Criar supabase/migrations/0187_nutrition_labels.sql"
```

---

## Implementation Strategy

### MVP real = US1 + US2

A US1 sozinha compila e calcula, mas com 7% de cobertura de açúcares adicionados ela produz rótulo incompleto na maioria dos preparos reais. **O primeiro incremento entregável são as duas juntas.**

1. Phase 1 (Setup) → os números da norma.
2. Phase 2 (Foundational) → schema + arredondamento. **Bloqueia tudo.**
3. Phase 3 + Phase 4 (US1 + US2) → tabela + entrada manual.
4. **PARAR E VALIDAR**: quickstart passos 1-12, com a tela aberta de verdade.
5. Phase 5 (US3) → lupa.
6. Phase 6 (US4) → salvar e exportar.
7. **T033 antes do merge**, sempre.

---

## Notes

- **O erro mais caro desta feature não é técnico, é regulatório.** Um número errado em `reference.ts` vai para uma embalagem. Por isso T033 é bloqueante e por isso os números vivem num arquivo só, testado e revisável em PR.
- **Dois zeros diferentes**: o zero do Anexo IV (declaratório, correto) e o "não sei" (dado ausente). Confundi-los é falsear rótulo. T009, T019 e T025 existem para travar isso.
- **Arredondar só na apresentação.** Arredondar antes de somar propaga erro; antes de gravar, torna o dado irrecuperável.
- **A lupa nunca conclui pela ausência** a partir de dado faltante — `inconclusivo` existe para isso.
- Commitar por task ou grupo lógico; parar em qualquer checkpoint para validar a história isoladamente.
