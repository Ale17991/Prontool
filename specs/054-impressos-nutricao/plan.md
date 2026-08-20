# Implementation Plan: Impressos da consulta de nutrição

**Branch**: `054-impressos-nutricao` | **Date**: 2026-08-03 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `specs/054-impressos-nutricao/spec.md`

## Summary

Nove documentos em PDF, gerados sob demanda a partir de dados que **já estão
gravados**. Não há cálculo novo, tabela nova nem dependência nova: é uma camada
de apresentação sobre as features 046, 047, 049, 050, as curvas de crescimento e
as orientações.

O trabalho concentra-se em duas coisas: um **layout de até três colunas de
avaliação**, que ainda não existe no projeto, e o reuso dos motores de cálculo em
vez de recalcular dentro do PDF — para o número impresso nunca divergir do da
tela.

## Technical Context

**Language/Version**: TypeScript 5.4 sobre Node.js 20 LTS (runtime Vercel)
**Primary Dependencies**: Next.js 14.2 (Route Handlers), `@react-pdf/renderer`
(já em uso em 13 documentos), `@supabase/ssr` / `@supabase/supabase-js`, Zod.
**Sem novas dependências.**
**Storage**: PostgreSQL via Supabase, RLS por `tenant_id`. **Nenhuma migration
nova** — os impressos só leem.
**Testing**: Vitest (unit / contract / integration), no padrão do projeto.
**Target Platform**: Web (Vercel); PDF baixado pelo navegador.
**Project Type**: Web application (Next.js App Router, projeto único).
**Performance Goals**: geração em até 3 s num documento típico; até 5 s no mais
pesado (plano com muitas refeições).
**Constraints**: runtime `nodejs` obrigatório (o renderer não roda em edge);
fontes built-in (Helvetica), sem registro externo, para não introduzir
dependência de rede no cold-boot — decisão já tomada em
`anamnesis/export-pdf.tsx`.
**Scale/Scope**: 9 documentos, ~7 rotas novas, 1 componente de layout
compartilhado.

### Levantamento do que já existe (feito ANTES de planejar)

| Item                                                          | Situação                                                                                                                                       |
| ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `@react-pdf/renderer` + `ClinicHeader`                        | Em uso em 13 PDFs. Reusar.                                                                                                                     |
| `anamnesis/export-pdf.tsx`                                    | **Existe e é código morto**: nenhuma rota o importa. Aproveitar em vez de reescrever.                                                          |
| Prontuário, receituário, orçamento, etiqueta, oftalmo, rótulo | PDFs prontos; servem de molde.                                                                                                                 |
| Solicitação de exames                                         | **Já existe** (migration 0149, CRUD, PDF e seção na ficha). Fora de escopo — o levantamento inicial errou ao listar como lacuna.               |
| Motores de cálculo                                            | Puros e isomórficos (`diet/totals`, `nutrition/energy`, `body-composition`, `classify`, `growth/classify`, `adequacy`). Reusar sem recalcular. |

## Constitution Check

| Princípio                        | Aplicação nesta feature                                                                                                                                        |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **I. Integridade financeira**    | Não se aplica: não há valor financeiro envolvido.                                                                                                              |
| **II. Auditabilidade**           | A emissão registra no log de auditoria existente (`log_audit_event`), como já fazem prontuário e solicitação de exames. Sem tabela nova.                       |
| **III. Isolamento multi-tenant** | Toda rota filtra por `tenant_id` da sessão; nenhum identificador de clínica vem do cliente. Teste de contrato prova que paciente de outra clínica devolve 404. |
| **IV. TUSS/ANS**                 | Não se aplica.                                                                                                                                                 |
| **V. RBAC**                      | `requireRole(['admin','profissional_saude'])` em todas as rotas, coberto por `lint:auth`. Recepcionista não emite documento clínico.                           |

**LGPD**: paciente anonimizado não gera impresso identificado (FR-013). Os PDFs
**não são persistidos** em storage — são renderizados e devolvidos na resposta,
então não criam cópia de dado sensível fora do banco.

**Resultado do gate**: sem violação. Nada a registrar em Complexity Tracking.

## Project Structure

### Documentation (this feature)

```text
specs/054-impressos-nutricao/
├── spec.md
├── plan.md              # este arquivo
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   └── api.md
└── checklists/
    └── requirements.md
```

### Source Code (repository root)

```text
src/lib/pdf/
├── clinic-header.tsx            # existe
└── evolution-columns.tsx        # NOVO — N avaliações lado a lado

src/lib/core/nutrition/printouts/
├── shared.tsx                   # blocos e estilos comuns
├── plan-pdf.tsx                 # US1 — plano alimentar
├── assessment-pdf.tsx           # US2 — antropometria e bioimpedância
├── recall-pdf.tsx               # US4 — recordatório
├── labs-pdf.tsx                 # US4 — exames laboratoriais
├── growth-pdf.tsx               # US5 — avaliação infantil
└── pregnancy-pdf.tsx            # US5 — avaliação gestacional

src/lib/core/care-notes/
└── notes-pdf.tsx                # US3 — orientações

src/app/api/pacientes/[id]/
├── plano-alimentar/pdf/route.ts
├── avaliacao-nutricional/pdf/route.ts
├── recordatorio/pdf/route.ts
├── exames/pdf/route.ts
├── crescimento/pdf/route.ts
├── orientacoes/pdf/route.ts
└── anamnese/[recordId]/pdf/route.ts

tests/
├── unit/printouts-*.spec.ts
├── contract/printouts-rbac.spec.ts
└── integration/printouts-*.spec.ts
```

**Structure Decision**: os documentos ficam em `src/lib/core/**`, não em
`src/components/`, seguindo a convenção que os 13 PDFs existentes já
estabeleceram. O layout de colunas sobe para `src/lib/pdf/` porque serve a quatro
documentos diferentes.

## Abordagem por fase

**Fase 0 — Fundação** (bloqueia todo o resto): `shared.tsx` com os blocos comuns
(identificação do paciente, rodapé com paginação, tarja de rascunho, formatação
de número e do "sem dado") e `evolution-columns.tsx`.

**Fase 1 — US1 (P1)**: plano alimentar. Maior uso e a regra mais delicada —
grupos de substituição saem como alternativa, nunca somados.

**Fase 2 — US2 (P1)**: antropometria e bioimpedância, com as três colunas. É
onde o `evolution-columns` prova o valor.

**Fase 3 — US3 (P2)**: orientações e anamnese, esta reaproveitando o componente
morto.

**Fase 4 — US4 (P2)**: recordatório e exames.

**Fase 5 — US5 (P3)**: infantil e gestacional.

**Fase 6 — Polish**: conferência com a nutricionista (SC-003), suíte completa e
abrir cada PDF com olho humano.

Cada fase entrega valor sozinha: a US1 isolada já resolve o que acontece em toda
consulta.

## Riscos

1. **Divergência entre tela e papel** — o risco que destrói a confiança no
   sistema. Mitigação: nenhum PDF recalcula; todos recebem o resultado pronto dos
   mesmos motores que alimentam a tela, e um teste compara as duas saídas.
2. **Gráfico de crescimento dentro do PDF**: `recharts` é React DOM e **não**
   renderiza no `@react-pdf/renderer`. A curva precisa ser desenhada com as
   primitivas do renderer ou virar tabela de percentis (research D3).
3. **Documento longo quebrando mal**: anamnese de 60 perguntas ou plano de 8
   refeições atravessa páginas; sem controle de quebra, linhas partem ao meio.
4. **Gate por módulo**: cada impresso segue o módulo da funcionalidade que o
   alimenta; clínica sem `exames_lab` não vê o impresso de exames.

## Complexity Tracking

Sem violação de princípio constitucional. Nenhuma entrada necessária.
