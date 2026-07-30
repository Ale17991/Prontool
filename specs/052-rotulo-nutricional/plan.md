# Implementation Plan: Rótulo Nutricional de Produto

**Branch**: `052-rotulo-nutricional` | **Date**: 2026-07-29 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/052-rotulo-nutricional/spec.md`

## Summary

Gerar a tabela **INFORMAÇÃO NUTRICIONAL** de um produto alimentício a partir de um preparo (ingredientes + quantidades + rendimento), conforme **IN 75/2020** e **RDC 429/2020**, incluindo a determinação automática da rotulagem frontal (a "lupa"). Gated pelo módulo `nutri_rotulo`, que existe no catálogo desde a 042 e nunca teve tela.

**Abordagem**: reuso do que já existe, com uma regra nova que é o coração da feature.

- **Nutrientes já estão na base.** Os quatro específicos de rótulo (`ag_saturados_g`, `ag_trans_g`, `acucar_total_g`, `acucar_adicao_g`) entraram como micronutrientes na 049. **Nenhuma migration de nutriente.**
- **Números da norma em TS**, não no banco (research D2): são ~25 constantes fixadas em norma federal que clínica nenhuma edita. Ficam versionadas no git e cobertas por teste — que é o que se quer de um número impresso em embalagem.
- **O motor rastreia completude.** A soma reusa `diet/totals.ts` (047/049), mas devolve, por nutriente, se está completo, incompleto ou sobrescrito, e **quais ingredientes faltaram**. Esse rastreio é o requisito central: com 7% de cobertura de açúcares adicionados na base, imprimir 0 para dado desconhecido seria declaração falsa.
- **Tabelas próprias, sem paciente.** Um rótulo é o produto de um cliente da clínica, não a alimentação de alguém. Tela própria em Operação.

## Technical Context

**Language/Version**: TypeScript 5.4 sobre Node.js 20 LTS (runtime Vercel)
**Primary Dependencies**: Next.js 14.2 (App Router, RSC, Route Handlers), `@supabase/ssr` 0.5 / `@supabase/supabase-js` 2.45, Zod 3.23, Tailwind 3.4, shadcn/ui (Radix), `lucide-react`, `@react-pdf/renderer` (já em uso — receituário e relatórios). **Sem novas dependências** — o cálculo é regra de três mais comparação com limite.
**Storage**: PostgreSQL via Supabase (local: `supabase start` :54321) com RLS por `tenant_id`. **Migration nova**: `0187_nutrition_labels.sql` (última é a `0186` da feature 051) — tabelas `nutrition_labels` e `nutrition_label_ingredients`. **Sem alteração** em `foods` (os nutrientes de rótulo já existem no JSONB de micronutrientes desde a 049). **Sem tabela de referências normativas** (research D2).
**Testing**: Vitest (unit + integration + contract). Motor de composição e arredondamento com testes unitários (números batendo contra o cálculo manual — SC-002); rota com contract/RBAC + gate de módulo + isolamento multi-tenant.
**Target Platform**: Web (tela em Operação + rota API + exportação PDF).
**Project Type**: Web application (Next.js App Router, projeto único em `src/`).
**Performance Goals**: recomposição da tabela imperceptível no cliente (<16 ms) — o preparo tem dezenas de ingredientes, não milhares.
**Constraints**: motor puro e isomórfico (mesma função na tela e no servidor); **arredondamento só na apresentação**, nunca antes de somar ou gravar; **dado desconhecido nunca vira zero**; %VD sempre sobre os valores da norma, jamais sobre meta de paciente.
**Scale/Scope**: dezenas de rótulos por clínica, dezenas de ingredientes por rótulo. 4 histórias (P1 tabela, P1 completar à mão, P2 lupa, P2 salvar/exportar).

**Limitação conhecida declarada**: a cobertura da base é irregular — gorduras saturadas 86% e sódio 91%, mas gorduras trans 18%, açúcares totais 18% e **açúcares adicionados 7%** dos 6.575 alimentos AF. A entrada manual (US2) é o caminho principal, não a exceção.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- **I. Integridade Financeira Imutável**: N/A direto — a feature não cria registro financeiro. O espírito é respeitado por outro caminho: o rótulo **grava a versão da norma** usada (FR-021), de modo que um documento antigo continua explicável quando a referência mudar. O rótulo é editável (é rascunho de trabalho, não histórico contábil).
- **II. Auditabilidade Total**: criação e edição de rótulo auditam via `log_audit_event`, padrão do projeto. As referências normativas são constantes de código — auditadas por git, não por trilha de banco.
- **III. Isolamento Multi-Tenant**: `nutrition_labels` e `nutrition_label_ingredients` carregam `tenant_id` + RLS. Ingredientes vêm de `foods` (globais + próprios da clínica), que já respeita o isolamento. Contract test de isolamento.
- **IV. Conformidade TUSS/ANS**: N/A — rotulagem de alimento não é procedimento de saúde suplementar. **Mas há conformidade regulatória de outra ordem** (ANVISA), tratada com o mesmo rigor: números conferidos em fonte, versão gravada, e conferência contra o texto oficial como tarefa explícita antes do merge.
- **V. RBAC**: leitura e escrita restritas a `admin`/`profissional_saude`; tela e rota gated por `nutri_rotulo` com 404 `MODULE_DISABLED` (padrão 049/050). Contract test por papel.

**Resultado (pré-Phase 0)**: PASS — sem violações.

**Re-check pós-Phase 1**: PASS. O design não acrescenta superfície de risco: duas tabelas por tenant, nenhuma global nova, nenhuma coluna em tabela existente. O ponto de maior consequência não é técnico e sim regulatório — um número errado vai para uma embalagem —, e está endereçado por três mecanismos: números num arquivo único e testado, versão da norma gravada por rótulo, e conferência contra o texto oficial como tarefa bloqueante. Nenhuma entrada em Complexity Tracking necessária.

## Project Structure

### Documentation (this feature)

```text
specs/052-rotulo-nutricional/
├── plan.md              # Este arquivo
├── research.md          # Decisões + os números da norma conferidos (Phase 0)
├── data-model.md        # Entidades/migration (Phase 1)
├── quickstart.md        # Roteiro de validação manual (Phase 1)
├── contracts/
│   └── api.md           # Contrato da rota (Phase 1)
├── checklists/
│   └── requirements.md  # (já existente)
└── tasks.md             # (/speckit.tasks — não criado aqui)
```

### Source Code (repository root)

```text
src/
├── lib/core/nutrition/labeling/               # NOVO — domínio do rótulo
│   ├── reference.ts                           #   VDR, limites da lupa, não-significativos, NORMATIVE_VERSION
│   ├── rounding.ts                            #   Anexos III e IV — puro
│   ├── compose.ts                             #   composição + rastreio de completude (puro)
│   ├── front-of-pack.ts                       #   lupa: aplica | não aplica | inconclusivo
│   └── store.ts                               #   CRUD do rótulo (I/O)
├── lib/core/nutrition/diet/totals.ts          # REUSO — escala por regra de três
├── app/api/rotulos/route.ts                   # NOVO: GET lista / POST cria
├── app/api/rotulos/[id]/route.ts              # NOVO: GET / PATCH / DELETE
├── app/api/rotulos/[id]/pdf/route.ts          # NOVO: exportação
├── app/(dashboard)/operacao/rotulo-nutricional/
│   ├── page.tsx                               # NOVO (RSC, gate nutri_rotulo)
│   └── rotulo-client.tsx                      # NOVO — preparo + tabela ao vivo + lupa
├── app/(dashboard)/_components/sidebar-sections.ts   # ESTENDER: item gated nutri_rotulo
└── components/labels/nutrition-label-pdf.tsx  # NOVO — documento para impressão

supabase/migrations/0187_nutrition_labels.sql  # 2 tabelas por tenant + RLS
tests/{unit,integration,contract}/             # arredondamento; composição; lupa; RBAC/gate/isolamento
```

**Structure Decision**: projeto único Next.js (`src/`), seguindo o layout de 046/047/049/050 — domínio puro em `src/lib/core/nutrition/`, rotas em `src/app/api/`, tela em `src/app/(dashboard)/operacao/`. **Item novo na sidebar** (diferente da 050, que virou seção de prontuário): o rótulo não pertence a paciente, então precisa de porta de entrada própria. Isso exige atualizar as asserções de `tests/unit/dashboard-shell-sections.spec.ts`, que hoje cravam 8 itens em Operação.

## Complexity Tracking

> Sem violações de constituição — nenhuma justificativa necessária.
