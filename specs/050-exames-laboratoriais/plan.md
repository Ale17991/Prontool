# Implementation Plan: Exames Laboratoriais (resultados com faixas de referência)

**Branch**: `050-exames-laboratoriais` | **Date**: 2026-07-28 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/050-exames-laboratoriais/spec.md`

## Summary

Registrar resultados de exames laboratoriais por paciente e **classificá-los automaticamente** em baixo/normal/alto contra a faixa de referência do **sexo e idade** daquele paciente, com evolução no tempo e leitura no portal. Cross-especialidade, gated pelo módulo `exames_lab` (já existente no catálogo de entitlements).

**Abordagem**: máximo reuso, mínimo schema novo.

- **Persistência = motor de medições da feature 030** (decisão do usuário). Cada exame é uma linha em `patient_metric_types` com `specialty='laboratorio'`; cada resultado é uma linha append-only em `patient_measurements`. Isso já é o precedente literal: os 7 seeds da 0113 (glicemia de jejum, HbA1c, colesterol total, LDL, HDL, triglicerídeos, circunferência abdominal) **já são exames** morando nesse motor. Herda de graça: gráfico de evolução, metas (`patient_metric_goals`), portal, lançamento em lote atômico (`recordMeasurementsBatch`), exame próprio da clínica (`patient_metric_types.tenant_id`) e liga/desliga por clínica (`tenant_patient_metric_settings`).
- **Única tabela nova**: `lab_reference_ranges`, catálogo **global** read-only espelhando `dietary_reference_intakes` (0182) — recorte por `sex × faixa etária × state`, com `ref_min`/`ref_max` absolutos no lugar do `value` da DRI.
- **Motor de classificação** = análogo puro de `computeAdequacy` (049): `classifyLabResults(results, ranges) → baixo|normal|alto|sem_referencia`. Leitura **derivada, não persistida** — recalculável a qualquer momento; muda a faixa, muda a leitura, sem reescrever histórico.
- **UI = seção no prontuário** (decisão do usuário), ao lado de Bioimpedância/Sinais vitais, não tela nova em Operação. A page do paciente **já carrega** `listMeasurements` + `listEnabledMetricTypesForTenant` sem filtro de especialidade — a seção só filtra `specialty === 'laboratorio'`.

## Technical Context

**Language/Version**: TypeScript 5.4 sobre Node.js 20 LTS (runtime Vercel)
**Primary Dependencies**: Next.js 14.2 (App Router, RSC, Route Handlers), `@supabase/ssr` 0.5, `@supabase/supabase-js` 2.45, Zod 3.23, Tailwind 3.4, shadcn/ui (Radix), `recharts` (já em uso), `lucide-react`. **Sem novas dependências** — comparação com faixa é aritmética simples; a banda de referência no gráfico usa `ReferenceArea`, já disponível no recharts instalado.
**Storage**: PostgreSQL via Supabase (local: `supabase start` :54321) com RLS por `tenant_id`. **Migration nova**: `0184_lab_reference_ranges.sql` — tabela global `lab_reference_ranges` + seed dos exames em `patient_metric_types` (`specialty='laboratorio'`) + refresh do `catalog_baseline.patient_metric_types` (gotcha 0170). **Sem alteração** em `patient_measurements` (resultados usam o schema existente). **Gabarito das faixas**: `nutri-doc/Evonut.xlsm` → aba `BD_Exames` (a aba do AF tem as colunas de unidade e faixa **100% vazias** — ver research.md D9).
**Testing**: Vitest (unit + integration + contract). Motor de classificação com testes unitários (casos conhecidos, SC-002); lookup de faixa com integração; rota com contract/RBAC + gate de módulo + isolamento multi-tenant.
**Target Platform**: Web (prontuário SSR + seção client para lançamento/leitura ao vivo) + rota API + portal do paciente.
**Project Type**: Web application (Next.js App Router, projeto único em `src/`).
**Performance Goals**: classificação no cliente imperceptível (<16 ms); lookup de faixas = 1 query por paciente (mesmo padrão de `listDRIsForPatient`, filtro amplo + desempate em memória).
**Constraints**: motor de classificação puro/isomórfico (mesma função tela e servidor); resultados **append-only** (correção = novo registro, herdado da 030); catálogo de exames e faixas **global** (`tenant_id IS NULL`), resultados isolados por tenant; sexo/idade ausentes **não bloqueiam** o registro (só suprimem o flag).
**Scale/Scope**: ~100 analitos quantitativos no catálogo (de 319 linhas da planilha: ~180 são qualitativos e 22 são pseudo-painéis "(Completo)" — ambos fora do v1, ver research.md D10); ~115 faixas, ~22 delas divergindo por sexo; volume de resultados baixo por paciente. 3 histórias (P1 registro+flag, P2 evolução, P3 portal).

**Limitação conhecida declarada**: a fonte recorta as faixas **só por sexo** — não há faixa etária nem estado gestacional em nenhuma das planilhas. O schema e o lookup implementam os três eixos (como pede FR-002), mas o seed preenche `0–130 / padrao`, então **o v1 classifica na prática por sexo**. Inserir faixas mais específicas depois não exige mudança de código (research.md D11).

## Constitution Check

_GATE: Must pass before Phase 0 research. Re-check after Phase 1 design._

- **I. Integridade Financeira Imutável**: N/A direto (feature clínica, sem registro financeiro). O espírito de append-only é respeitado: `patient_measurements` já é append-only por trigger (`enforce_append_only_columns('')`), correção = nova linha.
- **II. Auditabilidade Total**: escrita de resultado audita via `log_audit_event` — já implementado em `recordMeasurement`/`recordMeasurementsBatch` (`p_entity: 'patient_measurements'`). Faixas de referência são catálogo global read-only pela clínica (sem superfície de escrita para auditar).
- **III. Isolamento Multi-Tenant**: resultados herdam `tenant_id` + RLS de `patient_measurements`. `lab_reference_ranges` é catálogo global sem `tenant_id` (RLS `SELECT USING (true)`, sem GRANT de escrita). Exame próprio da clínica usa o namespacing existente `c<tenant8>_<slug>` com guarda `METRIC_TYPE_FOREIGN` no trigger da 0123. Contract test de isolamento.
- **IV. Conformidade TUSS/ANS**: N/A (resultado de exame não é cobrança). O pedido de exame (`exam_requests`, 0149) já usa TUSS tabela 22 e **não é tocado** nesta feature.
- **V. RBAC**: leitura/escrita restritas a `admin`/`profissional_saude` (RLS de `patient_measurements` já exige isso no INSERT) + `requireRole` server-side na rota. Gate `exames_lab` retorna 404 `MODULE_DISABLED` (padrão 049). Contract test por papel.

**Resultado (pré-Phase 0)**: PASS — sem violações.

**Re-check pós-Phase 1**: PASS. O design final **reduz** superfície em vez de aumentar — uma única tabela nova, toda ela catálogo global read-only, e nenhuma coluna nova em tabela transacional. Dois pontos reforçam os princípios: a classificação é **derivada e não persistida** (corrigir uma faixa reclassifica o histórico sem reescrever registro, alinhado ao Princípio I), e a única superfície de escrita nova (`POST .../exames`) delega a `recordMeasurementsBatch`, que já audita e já é atômica. Nenhuma entrada em Complexity Tracking necessária.

## Project Structure

### Documentation (this feature)

```text
specs/050-exames-laboratoriais/
├── plan.md              # Este arquivo
├── research.md          # Decisões técnicas (Phase 0)
├── data-model.md        # Entidades/migration (Phase 1)
├── quickstart.md        # Roteiro de validação manual (Phase 1)
├── contracts/
│   └── api.md           # Contrato da rota (Phase 1)
├── checklists/          # (já existente)
└── tasks.md             # (/speckit.tasks — não criado aqui)
```

### Source Code (repository root)

```text
src/
├── lib/core/labs/                              # NOVO — domínio de exames laboratoriais
│   ├── catalog.ts                              #   exames do catálogo (specialty='laboratorio')
│   ├── reference-ranges.ts                     #   lookup por sexo/idade/estado (molde: dri/read.ts)
│   └── classify.ts                             #   motor puro baixo/normal/alto (molde: adequacy.ts)
├── lib/core/patient-portal/
│   ├── measurements.ts                         # REUSO sem alteração (recordMeasurementsBatch)
│   ├── metric-types.ts                         # REUSO sem alteração (listEnabledMetricTypesForTenant)
│   ├── sections.ts                             # ESTENDER: 'exames' → implemented:true + requiredModule
│   └── read-portal.ts                          # ESTENDER: bundle carrega exames classificados
├── app/api/pacientes/[id]/exames/route.ts      # NOVO: GET (resultados+faixas+flag) / POST (lote)
├── app/(dashboard)/operacao/pacientes/[id]/
│   ├── lab-results-section.tsx                 # NOVO: seção do prontuário
│   └── _components/cadastro-tab.tsx            # ESTENDER: monta a seção
├── app/paciente/[slug]/painel/page.tsx         # ESTENDER: bloco de exames (gated 'exames')
└── components/patient-portal/evolution-chart.tsx  # ESTENDER: props refMin/refMax → ReferenceArea

supabase/migrations/0184_lab_reference_ranges.sql   # tabela global + seed do catálogo + baseline
scripts/build-lab-ranges-seed.ts                    # importador das planilhas (molde: build-dris-seed.ts)
tests/{unit,integration,contract}/                  # classificação; lookup; RBAC/gate/isolamento
```

**Structure Decision**: projeto único Next.js (`src/`), seguindo o layout de 046/047/049 — domínio puro em `src/lib/core/`, rota em `src/app/api/`, UI acoplada ao prontuário existente. **Nenhuma rota nova de navegação** e **nenhum item novo na sidebar** (a seção vive dentro da ficha do paciente), o que evita mexer nas 3 asserções de `tests/unit/dashboard-shell-sections.spec.ts` que cravam os 8 itens de Operação.

## Complexity Tracking

> Sem violações de constituição — nenhuma justificativa necessária.
