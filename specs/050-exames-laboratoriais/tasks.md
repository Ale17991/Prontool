---
description: 'Task list — 050 Exames Laboratoriais'
---

# Tasks: Exames Laboratoriais (resultados com faixas de referência)

**Input**: Design documents from `/specs/050-exames-laboratoriais/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/api.md, quickstart.md

**Tests**: incluídos e **obrigatórios**. A constituição (§ Fluxo de Desenvolvimento) exige, para funcionalidade que afeta acesso multi-tenant: teste de isolamento entre tenants e teste de autorização por papel para cada endpoint. Somam-se testes unitários do motor de classificação (SC-002).

**Organização**: agrupadas por user story, cada uma entregável e testável isoladamente.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: paralelizável (arquivos diferentes, sem dependência pendente)
- **[Story]**: US1 / US2 / US3

## Path Conventions

Projeto único Next.js: `src/` e `tests/` na raiz do repositório; migrations em `supabase/migrations/`; scripts em `scripts/`.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: extrair o dado real da planilha e transformá-lo no catálogo TS que todo o resto consome.

- [x] T001 Escrever script exploratório (DRY, descartável, no scratchpad da sessão) que lê `nutri-doc/Evonut.xlsm` aba `BD_Exames` via `ExcelJS.stream.xlsx.WorkbookReader` (header linha 3, dados 4–322) e emite CSV/JSON com `nome | grupo | unidade | refMinH | refMaxH | refMinM | refMaxM`, mais as contagens de controle: total de linhas, linhas com faixa, linhas com unidade, grupos distintos e strings de unidade distintas. Gotchas: `.xlsm` de ~7 MB estoura heap no `readFile`; `tsx` roda em CJS (sem top-level await → `main().catch()`).
- [x] T002 Criar o catálogo `src/lib/core/labs/catalog.ts` com `LabAnalyteDef` e `LAB_ANALYTES` (`key`, `label`, `unit`, `group`, `aliases?`, `displayOrder?`), a partir da saída de T001, filtrando **só os analitos quantitativos** (têm unidade e ao menos um limite) e **excluindo** o grupo `Exames Completos` (research.md D10). Analitos novos usam prefixo `lab_` no formato `^[a-z][a-z0-9_]{1,63}$`; os 6 exames já semeados na `0113` entram com as **chaves legadas** (`glicemia_jejum`, `hba1c`, `colesterol_total`, `ldl`, `hdl`, `triglicerides`) e **não** podem ser redeclarados com chave nova. Deduplicar analitos que a planilha repete em vários grupos com faixa idêntica (`Ácido úrico`, `Potássio`, `HDL`).
- [x] T003 [P] Criar o mapa de normalização de unidades em `src/lib/core/labs/units.ts`: `TRIM` + aliases contra as 37 unidades canônicas do AF (`µg/dL`→`mcg/dL`, `mcg/Ml`→`mcg/mL`, `mcUI/mL`→`mUI/L`, `" U/L"`→`U/L`, `" g/dL"`→`g/dL`, …) e função `normalizeUnit(raw): string` que **lança** em unidade desconhecida (research.md — falhar ruidosamente, nunca gravar variante nova).
- [x] T004 [P] Adicionar um teste unitário de coerência do catálogo em `tests/unit/labs-catalog.spec.ts`: chaves únicas e no formato do CHECK de `patient_metric_types`, nenhuma colisão com as 6 chaves legadas, toda `unit` presente passa por `normalizeUnit` sem lançar.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: schema e dados que TODAS as histórias exigem.

**⚠️ CRÍTICO**: nenhuma user story começa antes desta fase fechar.

- [x] T005 Criar `supabase/migrations/0184_lab_reference_ranges.sql` — parte 1: tabela global `public.lab_reference_ranges` (`id`, `analyte_key`, `sex` CHECK `M|F|any`, `age_min_years`, `age_max_years`, `state` CHECK `padrao|gestante|lactante` DEFAULT `padrao`, `ref_min NUMERIC(14,4) NULL`, `ref_max NUMERIC(14,4) NULL`, `unit`, `source_label`), UNIQUE `lab_range_natural_key (analyte_key, sex, age_min_years, age_max_years, state)`, índice `lab_range_lookup_idx (analyte_key, sex, state)`, CHECKs `age_max > age_min`, `ref_min IS NOT NULL OR ref_max IS NOT NULL` e `ref_max >= ref_min` quando ambos existem. **Sem `tenant_id`**. RLS `ENABLE` + policy `SELECT TO authenticated USING (true)`; `GRANT SELECT` a `authenticated, service_role` — **sem** GRANT de escrita. Espelhar a `0182_dietary_reference_intakes.sql`; idempotente (`IF NOT EXISTS` / `DROP POLICY IF EXISTS`).
- [x] T006 Na mesma `supabase/migrations/0184_lab_reference_ranges.sql` — parte 2: `INSERT INTO public.patient_metric_types (metric_type, label, unit, min_plausible, max_plausible, specialty, display_order) VALUES … ON CONFLICT (metric_type) DO NOTHING` com os analitos de `LAB_ANALYTES` que ainda não existem, todos com `specialty='laboratorio'`. **Dimensionar a faixa plausível com folga**: `min_plausible = 0` e `max_plausible ≥ 10× o limite superior de referência` — é anti-typo, não faixa clínica; apertado demais rejeita no INSERT justamente o resultado muito alterado (422 `MEASUREMENT_OUT_OF_RANGE`). Não tocar nas 6 linhas legadas da `0113` (linhas globais são append-only).
- [x] T007 Na mesma `supabase/migrations/0184_lab_reference_ranges.sql` — parte 3: bloco `DO $$` replicando as linhas novas em `catalog_baseline.patient_metric_types` quando `to_regclass('catalog_baseline.patient_metric_types') IS NOT NULL`, copiando o padrão das linhas 115-129 de `0175_nutrition_assessments.sql`. **Obrigatório**: `patient_metric_types` é truncada e restaurada do baseline em `resetDatabase()`; sem isso os exames somem a cada `vitest`. `lab_reference_ranges` fica **fora** do baseline (seed re-executável, testes self-contained — mesma escolha da 0182).
- [x] T008 Rodar `pnpm supabase:reset` e `pnpm supabase:gen-types` para aplicar a 0184 localmente e regenerar `src/lib/db/types.ts` com a tabela nova.
- [x] T009 Criar `scripts/build-lab-ranges-seed.ts` no molde de `scripts/build-dris-seed.ts`: streaming do `Evonut.xlsm`/`BD_Exames`; mapa de colunas `A=Cod, B=Desc, C=Grupo, D=Unidade, E=RefMinH, F=RefMaxH, G=RefMinM, H=RefMaxM`; descarta qualitativos e `Exames Completos`; `normalizeUnit` (T003); resolve `analyte_key` por nome normalizado contra `LAB_ANALYTES` + `aliases`, **reportando** (não inventando) nome não mapeado; deduplica; emite **1 linha `sex='any'`** quando `(E,F) == (G,H)` ou **2 linhas** (`M` com E/F, `F` com G/H) quando divergem; `age_min_years=0`, `age_max_years=130`, `state='padrao'`, `source_label` fixo. `DRY=1` só imprime contagens; senão `createClient` service_role + `delete` + `insert` em chunks de 500 (idempotente).
- [x] T010 Adicionar os scripts `seed:lab-ranges` e `seed:lab-ranges:prod` ao `package.json`, no padrão dos existentes (`--env-file=.env.local` / `.env.production.local`).
- [x] T011 Rodar `DRY=1 pnpm seed:lab-ranges` e conferir as contagens contra o levantamento (≈115 linhas com faixa aproveitadas de 319; ≈180 qualitativas + 22 pseudo-painéis descartados; **zero** unidade desconhecida e zero nome não mapeado). Corrigir catálogo/aliases até fechar; então rodar `pnpm seed:lab-ranges` valendo no banco local.

**Checkpoint**: schema aplicado, catálogo semeado e faixas carregadas — as user stories podem começar.

---

## Phase 3: User Story 1 - Registrar resultado com flag automático (Priority: P1) 🎯 MVP

**Goal**: lançar resultados de um paciente e ver cada um classificado baixo/normal/alto contra a faixa do seu sexo/idade, com os alterados em destaque.

**Independent Test**: escolher um paciente com sexo e nascimento preenchidos, lançar 8–10 exames e conferir valor, faixa exibida e classificação; repetir com paciente de sexo oposto num analito que diverge (ferritina, hemoglobina) e ver a classificação mudar.

### Tests for User Story 1

- [x] T012 [P] [US1] Teste unitário do motor em `tests/unit/labs-classify.spec.ts`: `value < refMin` → `baixo`; `value > refMax` → `alto`; valor **igual** a qualquer limite → `normal` (comparação inclusiva); só-teto (`refMin` null) nunca classifica `baixo`; só-piso (`refMax` null) nunca classifica `alto`; ambos null ou analito ausente do Map → `sem_referencia`; contadores `low`/`high` corretos; ordenação põe os alterados primeiro.
- [x] T013 [P] [US1] Teste de integração do lookup em `tests/integration/lab-reference-ranges.spec.ts`: semeia faixas próprias (self-contained) e prova o desempate por score — sexo específico vence `any`, `state` informado vence `padrao`, idade fora de toda faixa devolve o analito ausente do Map. Caso central: **mesma ferritina classifica diferente em paciente M e F**.
- [x] T014 [P] [US1] Teste de contrato em `tests/contract/lab-results-route.spec.ts`: GET e POST negam papel `recepcionista`/`financeiro` (403) e aceitam `admin`/`profissional_saude`; módulo `exames_lab` desligado → **404 `MODULE_DISABLED`** em ambos (SC-005); paciente de outro tenant → não vaza (SC-006); POST com corpo inválido → 400 `INVALID_BODY`; POST com valor fora da faixa plausível → 422 e **nada gravado do lote** (atomicidade).

### Implementation for User Story 1

- [x] T015 [P] [US1] Implementar `src/lib/core/labs/reference-ranges.ts` — `listLabRangesForPatient(supabase, { ageYears, sex, state? }): Promise<Map<string, LabRange>>`, copiando o algoritmo de `src/lib/core/nutrition/dri/read.ts`: uma query com filtro amplo (`lte age_min`, `gte age_max`, `in sex [informado,'any']`, `in state`) e desempate em memória por score (estado peso 2, sexo peso 1).
- [x] T016 [P] [US1] Implementar `src/lib/core/labs/classify.ts` — puro/isomórfico, sem I/O: `LabClass`, `LabResultItem`, `LabPanelResult` e `classifyLabResults(results, ranges)`, no molde de `src/lib/core/nutrition/adequacy.ts`. A classificação **não é persistida**.
- [x] T017 [US1] Criar a rota `src/app/api/pacientes/[id]/exames/route.ts` conforme `contracts/api.md`. GET: `requireRole(['admin','profissional_saude'])` + gate `exames_lab` (helper local `gate()` + `moduleDisabled()` no padrão de `src/app/api/pacientes/[id]/recordatorio/route.ts`), lê medições via `listMeasurements`, resolve idade/sexo por query param ou `rpc('get_patient_for_tenant')`, e devolve `{ patient, panel, series }` — ou **200** com `{ panel: null, need: { age, sex } }` quando faltar sexo/idade (copiar `src/app/api/pacientes/[id]/adequacao/route.ts:88-93`). POST: Zod (`measuredAt` ISO não-futura, `results` 1..60, `analyteKey` no catálogo) e delega a `recordMeasurementsBatch`. `toHttpResponse(err, { route })` no catch.
- [x] T018 [US1] Criar a seção `src/app/(dashboard)/operacao/pacientes/[id]/lab-results-section.tsx` (`'use client'`) no molde de `metabolic-metrics-section.tsx`: painel com o **último resultado de cada analito** (alterados primeiro), mostrando valor, unidade, **faixa de referência ao lado**, data e badge baixo/normal/alto (tokens `bg-success-bg`/`--warning`/`--alert`, como `bmiClassification`); marcação **"sem referência"** sem badge quando não há faixa; formulário de laudo (data + N analitos via typeahead sobre `LAB_ANALYTES`, agrupado por painel); campos de sexo/idade quando a rota devolver `need`; aviso explícito de que a correção é **novo lançamento** (append-only).
- [x] T019 [US1] Montar a seção em `src/app/(dashboard)/operacao/pacientes/[id]/_components/cadastro-tab.tsx`, ao lado de `<MetabolicMetricsSection …>`, passando `patientId` e `canWrite`. A page já carrega `listMeasurements` e `listEnabledMetricTypesForTenant` sem filtro de especialidade — reaproveitar, sem query nova no RSC.
- [x] T020 [US1] Em `src/app/(dashboard)/operacao/pacientes/[id]/metabolic-metrics-section.tsx`, excluir do seletor genérico de métricas os analitos declarados em `LAB_ANALYTES`, para que os ~100 exames não inundem o dropdown de medições. Ajustar o teste estrutural correspondente se houver.

**Checkpoint**: US1 funcional e testável sozinha — é o MVP.

---

## Phase 4: User Story 2 - Evolução do exame no tempo (Priority: P2)

**Goal**: ver a série de um exame ao longo do tempo, com a faixa normal desenhada como referência visual.

**Independent Test**: com ≥2 resultados do mesmo exame em datas diferentes, abrir a evolução e ver a linha e a banda de referência.

### Tests for User Story 2

- [x] T021 [P] [US2] Teste unitário em `tests/unit/labs-chart-domain.spec.ts` do helper que calcula o `domain` do eixo Y a partir dos pontos **e** dos limites de referência: a banda nunca fica fora do gráfico; funciona com `refMin` ou `refMax` nulo; sem faixa, o domínio permanece o atual (`['auto','auto']`).

### Implementation for User Story 2

- [x] T022 [US2] Estender `src/components/patient-portal/evolution-chart.tsx` — `MetricEvolutionChart` ganha props **opcionais** `refMin?: number | null` e `refMax?: number | null`; quando presentes, importa `ReferenceArea` do recharts (já instalado, sem nova dep) e renderiza a banda, com `YAxis domain` calculado para englobá-la. Props opcionais → todos os usos atuais (`metabolic-metrics-section.tsx:17` e o portal) seguem intactos. **Não mover o arquivo** de diretório (research.md D7).
- [x] T023 [US2] Plugar na seção `lab-results-section.tsx`: ao expandir um analito, renderizar `MetricEvolutionChart` com a `series[analyteKey]` devolvida pelo GET e os `refMin`/`refMax` do item. Um único ponto mantém a mensagem existente ("a linha aparece a partir da segunda medição").

**Checkpoint**: US1 e US2 funcionam independentemente.

---

## Phase 5: User Story 3 - Resultados no portal do paciente (Priority: P3)

**Goal**: o paciente vê seus exames recentes no portal com normal/alterado, sem jargão e sem alarmismo.

**Independent Test**: ligar a seção nas configurações, entrar no portal como paciente e ver os resultados com o flag; desligar e conferir que some.

### Tests for User Story 3

- [x] T024 [P] [US3] Teste em `tests/integration/portal-exames-section.spec.ts`: com `exames_lab` **desligado**, `resolvePortalSections` não devolve `exames` mesmo com override da clínica ligado; com o módulo ligado, o default permanece **desligado** (`defaultEnabled: false`, dado sensível) e só aparece após o override; o bundle não carrega exames quando a seção está off.

### Implementation for User Story 3

- [x] T025 [US3] Em `src/lib/core/patient-portal/sections.ts`: incluir `'exames_lab'` no union `PortalSectionModule` (hoje `'treino' | 'dieta' | 'telemedicina'`) e, na def da chave `'exames'` (já existente, linha ~104), setar `implemented: true` e `requiredModule: 'exames_lab'`. Manter `defaultEnabled: false` e `sensitivity: 'alta'`.
- [x] T026 [US3] Em `src/lib/core/patient-portal/read-portal.ts`: acrescentar `labResults: LabResultItem[] | null` ao `PatientPortalBundle` e carregá-lo em `buildPatientPortalBundle` reusando `listLabRangesForPatient` + `classifyLabResults` (último resultado por analito). Carregar só quando a seção estiver habilitada.
- [x] T027 [US3] Criar o card `src/components/patient-portal/lab-results-card.tsx` no molde de `plan-cards.tsx`: valor, unidade, data e **normal/alterado** — sem percentual, sem faixa crua isolada e sem alarmismo (SC-003), coerente com a descrição já registrada na def da seção ("Resultados com interpretação (nunca o valor cru isolado)").
- [x] T028 [US3] Em `src/app/paciente/[slug]/painel/page.tsx`: `const showExames = enabled.has('exames')` e renderizar o card na coluna lateral, seguindo o padrão dos blocos condicionais existentes (`:54-59`).

**Checkpoint**: as três histórias funcionam independentemente.

---

## Phase 6: Polish & Cross-Cutting Concerns

- [x] T029 Rodar `pnpm typecheck`, `pnpm lint:auth` e `pnpm lint` — zero erros. `lint:auth` confirma `requireRole` na rota nova.
- [x] T030 Rodar a suíte completa (`pnpm test`) e corrigir os testes estruturais que a feature quebrar (precedente: a 045 e a sidebar quebraram `configuracoes-hub`, `report-empty-period` e `dashboard-shell-sections` ao mudar contratos sem atualizar os testes que os cravam). ⚠️ `vitest` apaga o banco local — re-seedar depois com `pnpm seed:demo` + `pnpm seed:lab-ranges`.
- [x] T031 [P] Atualizar o `CLAUDE.md` com a feature 050 (a seção "Active Technologies" já foi atualizada pelo script; acrescentar o que for de arquitetura).
- [ ] T032 Executar o roteiro de `quickstart.md` ponta a ponta com o app rodando (`pnpm dev`) — **inclusive abrir a tela com olho humano**, que é a dívida recorrente das features de nutrição (046/047/049 foram para produção sem isso).
      **PENDENTE — tentativa automatizada falhou.** O dev server sobe normal (porta 3002, responde 200), mas a extensão do Chrome recusa renderizar `localhost`/`127.0.0.1` ("Frame is showing error page", 4 tentativas) — é permissão de site na extensão, não o código. **Substituto parcial obtido**: `pnpm build` passou com **exit 0** (22 rotas; `/operacao/pacientes/[id]` = 67,4 kB), o que prova que a seção compila e entra no bundle — mas NÃO prova que a tela está usável. Nota: `pnpm seed:demo` **não cria pacientes**; é preciso criar um à mão, com sexo e data de nascimento, senão a classificação não roda. Roteiro de cliques entregue ao usuário.
- [ ] T033 Validação com o profissional: conferir amostra de 10–15 faixas contra a referência usada na prática, declarando as duas limitações conhecidas — faixas de planilha sem fonte citada, e **classificação por sexo apenas** (a fonte não tem recorte etário). Decidir se alguma faixa precisa de correção antes de expor a clínicas reais.
- [x] T034 Deploy: mergear em `master` + push (a integração GitHub da Supabase aplica a 0184 automaticamente no push — **não** aplicar à mão), rodar `pnpm seed:lab-ranges:prod`, e ligar o módulo `exames_lab` no `/admin` para os tenants alvo. Se der `MIDDLEWARE_INVOCATION_FAILED`, redeploy na Vercel **sem** cache de build.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: sem dependências. T002 depende de T001 (precisa do dado extraído).
- **Foundational (Phase 2)**: depende de T002 (a migration semeia o que o catálogo declara). **BLOQUEIA todas as user stories.**
- **US1 (Phase 3)**: depende da Phase 2 completa.
- **US2 (Phase 4)**: depende da Phase 2; na prática consome o `series` que T017 devolve — implementar depois de US1.
- **US3 (Phase 5)**: depende da Phase 2 e reusa T015/T016 (lookup + motor) de US1.
- **Polish (Phase 6)**: depois das histórias desejadas.

### User Story Dependencies

- **US1 (P1)**: independente. É o MVP.
- **US2 (P2)**: independentemente testável, mas reusa a rota de US1 — sequenciar após US1.
- **US3 (P3)**: independentemente testável, reusa o motor de US1 — sequenciar após US1.

### Within Each User Story

Testes escritos antes e falhando → motor puro → lookup → rota → UI.

### Parallel Opportunities

- T003 e T004 em paralelo com T002 depois de T001.
- T012, T013 e T014 (testes de US1) em paralelo.
- T015 e T016 em paralelo (arquivos distintos, sem dependência mútua).
- US2 e US3 em paralelo entre si depois de US1 fechada.

---

## Parallel Example: User Story 1

```bash
# Testes de US1 juntos:
Task: "Teste unitário do motor em tests/unit/labs-classify.spec.ts"
Task: "Teste de integração do lookup em tests/integration/lab-reference-ranges.spec.ts"
Task: "Teste de contrato em tests/contract/lab-results-route.spec.ts"

# Domínio puro de US1 junto:
Task: "Implementar src/lib/core/labs/reference-ranges.ts"
Task: "Implementar src/lib/core/labs/classify.ts"
```

---

## Implementation Strategy

### MVP First (User Story 1)

1. Phase 1 (Setup) → catálogo TS derivado da planilha.
2. Phase 2 (Foundational) → migration + seed. **Bloqueia tudo.**
3. Phase 3 (US1) → registro + flag.
4. **PARAR E VALIDAR**: quickstart passos 1–7, com a tela aberta de verdade.
5. Deploy se aprovado.

### Incremental Delivery

1. Setup + Foundational → fundação pronta.
2. - US1 → testar → deploy (MVP).
3. - US2 (evolução) → testar → deploy.
4. - US3 (portal) → testar → deploy.

---

## Notes

- `[P]` = arquivos diferentes, sem dependência pendente.
- **A armadilha mais provável desta feature** é `min_plausible`/`max_plausible` apertados (T006): rejeitam no INSERT justamente o resultado clinicamente muito alterado. Se o quickstart passo 7 falhar com ferritina 2000, é isso.
- Resultados são **append-only** por herança da 0113 — não existe editar/excluir; a UI precisa dizer isso.
- A classificação é derivada e nunca gravada: corrigir uma faixa reclassifica todo o histórico sem tocar em registro.
- Commitar por task ou grupo lógico; parar em qualquer checkpoint para validar a história isoladamente.
