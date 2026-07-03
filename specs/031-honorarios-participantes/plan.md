# Implementation Plan: Honorários e participantes (equipe) por procedimento

**Branch**: `031-honorarios-participantes` | **Date**: 2026-06-18 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `specs/031-honorarios-participantes/spec.md`

## Summary

Registrar, por **linha de procedimento** de um atendimento, a equipe de participantes adicionais (anestesista, auxiliar, instrumentador…), cada um com **grau de participação** (domínio TISS 35) e **honorário** congelado. O honorário soma no **repasse mensal** do profissional, independentemente da modalidade (liberal/fixo/comissionado), e alimenta o bloco **equipeSadt** da guia TISS SP/SADT.

**Abordagem técnica**: **estender** a tabela append-only `appointment_assistants` (feature 013/0084) — que já vincula múltiplos participantes a um atendimento, congela o valor e já é somada no repasse — em vez de criar tabela nova. Acrescenta-se `procedure_id` (FK para `appointment_procedures`) e `participation_degree` (domínio 35), e relaxa-se o trigger que hoje restringe a `payment_mode='liberal'`. Isso entrega "qualquer modalidade soma no repasse" (FR-003/FR-014) reutilizando o caminho `aggregateLiberalByDoctor` e o `close_monthly_payout` já existentes, sem dupla contagem (o executante principal continua fora da equipe — FR-015).

## Technical Context

**Language/Version**: TypeScript 5.4 sobre Node.js 20 LTS (runtime Vercel)
**Primary Dependencies**: Next.js 14.2 (App Router, RSC, Server Actions), `@supabase/ssr` 0.5, `@supabase/supabase-js` 2.45, Zod 3.23, Tailwind 3.4, shadcn/ui (Radix), `lucide-react`. TISS: `xmlbuilder2` + `xmllint-wasm` (já presentes). **Sem novas deps.**
**Storage**: PostgreSQL via Supabase com RLS por `tenant_id`. **Migration nova**: `0128_procedure_participants.sql` — ALTER `appointment_assistants` (acrescenta `procedure_id`, `participation_degree`; relaxa trigger liberal-only; nova unique parcial por `(appointment_id, procedure_id, assistant_doctor_id)`). **Leitura**: `tiss_domain_tables` domínio `35` (grau de participação — **já semeado** por `scripts/seed-tiss-domains.ts`). Sem mudança em `monthly_payouts` (o caminho de repasse já lê `appointment_assistants`).
**Testing**: vitest — contrato (append-only, tenant isolation, RBAC), integração (participação → repasse; participação → equipe SP/SADT), teste-âncora XSD da SP/SADT com `equipeSadt`.
**Target Platform**: Web (navegador) + API Route Handlers (Vercel/Node).
**Project Type**: Web application (Next.js full-stack).
**Performance Goals**: interações de UI sob ~1s; geração de guia/lote dentro dos limites já praticados pelo TISS.
**Constraints**: valores em centavos; timestamps UTC; append-only (correção = soft-unlink + novo registro); PII/segredos inalterados.
**Scale/Scope**: 1 migration, ~1 tabela estendida, ~3-4 rotas, alterações em `monthly-payouts` (rótulo), `build-guia`/`render-spsadt` (equipe), UI do atendimento por procedimento.

## Constitution Check

_GATE: passa antes da Phase 0 e revalidado após Phase 1._

- **I. Integridade Financeira Imutável** ✅ — Reusa tabela append-only; honorário congelado no INSERT; correção via soft-unlink + novo registro. Nenhum UPDATE/DELETE físico de valor. Novas colunas são aditivas.
- **II. Auditabilidade Total** ✅ — Inclusão e remoção de participação chamam `log_audit_event` (ator, timestamp, tenant, valores, motivo, ip/ua), padrão já usado em assistentes.
- **III. Isolamento Multi-Tenant** ✅ — `tenant_id` em todas as linhas; RLS por `jwt_tenant_id()`; trigger de consistência de tenant entre appointment/doctor/procedure; PK UUID; rotas chamam `requireRole`.
- **IV. Conformidade TUSS/ANS** ✅ — Grau vem do catálogo oficial (domínio 35), nunca texto livre; a guia SP/SADT com `equipeSadt` é validada contra o XSD 04.03.00 (teste-âncora). Divergência de domínio é rejeitada, não silenciosa.
- **V. RBAC** ✅ — Adicionar/remover participação (valor financeiro) exige `admin`/`financeiro` no servidor; negações logadas; ver valores respeita `finance.view_values`.

**Resultado**: sem violações. Seção "Complexity Tracking" não necessária.

## Project Structure

### Documentation (this feature)

```text
specs/031-honorarios-participantes/
├── plan.md              # Este arquivo
├── research.md          # Phase 0 — decisões de design
├── data-model.md        # Phase 1 — schema e entidades
├── quickstart.md        # Phase 1 — validação ponta a ponta
├── contracts/           # Phase 1 — contratos de API/SQL
└── tasks.md             # Phase 2 (/speckit.tasks — não criado aqui)
```

### Source Code (repository root)

```text
supabase/migrations/
└── 0128_procedure_participants.sql        # ALTER appointment_assistants + trigger/índice

src/lib/core/
├── appointment-assistants/                # estende: criar com procedure_id + grau; permitir qualquer modalidade
│   ├── attach.ts (ou RPC equivalente)     # novo campo procedure_id + participation_degree
│   ├── list-by-appointment.ts             # passa a agrupar por procedimento + grau
│   └── sum-by-doctor-period.ts            # inalterado (já soma; agora vale p/ qualquer modalidade)
├── monthly-payouts/index.ts               # rótulo/semântica "liberal" → "participações" (mecanismo igual)
└── tiss/
    ├── build-guia.ts                      # generateSpSadtGuia lê participantes por linha → equipe
    └── xml/render-spsadt.ts               # renderiza bloco equipeSadt por procedimento

src/app/api/atendimentos/[id]/
└── participantes/                         # POST adicionar / DELETE remover participação por procedimento
    └── route.ts (+ [participantId]/route.ts)

src/app/(dashboard)/operacao/atendimentos/
└── _components/ + [id]/                    # UI: equipe por procedimento (profissional + grau + honorário)

tests/
├── contract/   procedure-participants-{append-only,rbac,tenant-isolation}.spec.ts
├── integration/ participant-feeds-repasse.spec.ts, spsadt-equipe.spec.ts
└── contract/   tiss-render-spsadt-equipe-validates.spec.ts (âncora XSD)
```

**Structure Decision**: Web app full-stack Next.js já existente. A feature estende módulos existentes (`appointment-assistants`, `monthly-payouts`, `tiss`) e a UI do atendimento, com uma migration aditiva. Sem novo projeto/serviço.

## Complexity Tracking

Não aplicável — Constitution Check sem violações.
