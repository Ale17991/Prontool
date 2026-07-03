# Implementation Plan: Faturamento Médico Integrado ao GHL/Homio

**Branch**: `001-faturamento-medico-ghl` | **Date**: 2026-04-16 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `C:\My project\specs\001-faturamento-medico-ghl\spec.md`

## Summary

Sistema multi-tenant de faturamento médico que recebe eventos de atendimento
via webhook do GoHighLevel (GHL), calcula automaticamente o valor do
procedimento consultando tabela de preços versionada por vigência
(procedimento × plano × data), persiste atendimentos com valor e comissão
congelados (append-only), e gera relatórios mensais exportáveis em PDF/Excel.

A abordagem técnica usa **Next.js 14 (App Router) como app unificado
front+backend rodando em Vercel**, **Supabase (Postgres + Auth) como base
transacional com Row-Level Security (RLS) para isolamento de tenant**, e
**Upstash QStash como fila HTTP-nativa** para o processamento híbrido de
webhook (ack síncrono no log de eventos brutos, processamento semântico
assíncrono com DLQ). Imutabilidade e auditoria são impostas via triggers
PostgreSQL, e o catálogo TUSS é importado do repositório público
`charlesfgarcia/tabelas-ans` em script de seed versionado.

Divergências relevantes da stack sugerida pelo usuário (ver research.md):

1. **Express é removido em favor de Next.js Route Handlers unificados**
   — um único deploy na Vercel, mesmo runtime, menor superfície.
2. **`xlsx` (SheetJS) é substituído por `exceljs`** devido a CVEs abertos e
   distribuição fora do npm na versão community.
3. **Fila QStash é adicionada** porque Vercel serverless sozinho não hospeda
   workers de fila — o híbrido (ack rápido + DLQ) do FR-008a–d exige um
   executor fora da requisição HTTP.

## Technical Context

**Language/Version**: TypeScript 5.4+ sobre Node.js 20 LTS (runtime Vercel).
**Primary Dependencies**:

- Next.js 14 (App Router, Server Actions, Route Handlers) — UI + API.
- `@supabase/supabase-js` + `@supabase/ssr` — cliente Postgres + Auth.
- Supabase Auth (provedor de identidade; custom JWT claims `tenant_id`, `role`).
- `@upstash/qstash` — fila HTTP com retries e DLQ para processamento
  assíncrono de eventos de webhook.
- `@react-pdf/renderer` — geração de PDF server-side.
- `exceljs` — geração de Excel server-side (substitui `xlsx`).
- `zod` — validação de payloads de webhook e forms.
- `resend` — entrega de e-mail de alertas operacionais.
- `pino` — logging estruturado com redaction de campos sensíveis.

**Storage**: PostgreSQL gerenciado via Supabase. RLS ativada em 100% das
tabelas de tenant. UUID como PK em todas as tabelas. Triggers garantem
append-only nas tabelas financeiras (`appointments`, `appointment_reversals`,
`price_versions`, `audit_log`, `doctor_commission_history`).

**Testing**:

- Vitest — unit + integration.
- Playwright — E2E de fluxos admin (gestão de preço, dashboard de alertas,
  geração de relatório).
- Supabase CLI local (Postgres + RLS reais) como backing store para testes
  de integração — mocks de DB são proibidos (reforça Principle I do constitution).

**Target Platform**:

- Frontend + API: Vercel (Next.js 14 runtime Node.js; região `gru1` São Paulo
  para latência Brasil).
- DB + Auth: Supabase (região São Paulo).
- Fila: Upstash QStash.
- E-mail: Resend.

**Project Type**: Web application (Next.js unificado frontend + backend).

**Performance Goals** (derivados de SC-001a/b/c e SC-004):

- Webhook ack p99 < 1 s.
- Processamento semântico de atendimento p95 < 10 s.
- Entrada na DLQ para falha de negócio < 30 s.
- Geração de relatório mensal (até 5 k atendimentos) < 30 s.
- Entrega de e-mail de alerta ao admin < 2 min em 95% dos casos.

**Constraints**:

- Função Vercel com timeout ≤ 60 s (plano Pro) — processamento semântico
  precisa caber ou ser redisparado pela fila.
- RLS obrigatória em 100% das tabelas de tenant (Principle III).
- Schema append-only para registros financeiros; UPDATE/DELETE proibidos via
  trigger (Principle I).
- Moeda armazenada como `BIGINT` em centavos BRL; nunca `float`.
- Timestamps sempre UTC na persistência; conversão para `America/Sao_Paulo`
  apenas na camada de apresentação.
- Dados pessoais de paciente (nome, CPF, telefone, e-mail, data nasc.)
  criptografados em repouso; ausentes de logs em texto claro (FR-010a, SC-011).

**Scale/Scope**:

- v1: tenant count estimado 10–50 clínicas no piloto (premissa; revalidar).
- Por clínica: até 5 k atendimentos/mês, ~500 procedimentos cadastrados,
  ~20 médicos, ~10 planos.
- Pico de webhooks esperado: 10–30 req/s por clínica em horário comercial;
  plataforma agregada: 300–1 500 req/s no pico — absorvida pela fila.

## Constitution Check

_GATE: Must pass before Phase 0 research. Re-check after Phase 1 design._

Avaliação contra os 5 Core Principles do constitution (`.specify/memory/constitution.md`):

| Principle                                           | Status | Como o plano atende                                                                                                                                                                                                                                                                                                         |
| --------------------------------------------------- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| I. Integridade Financeira Imutável (NON-NEGOTIABLE) | PASS   | Tabelas financeiras são append-only; triggers `BEFORE UPDATE OR DELETE` bloqueiam mutação; reversão é registro compensatório append-only (FR-027–32). Valor e comissão de atendimento são congelados na criação.                                                                                                            |
| II. Auditabilidade Total de Preços (NON-NEGOTIABLE) | PASS   | Trigger de nível de banco insere em `audit_log` em cada INSERT de `price_versions`, `doctors` (alteração de comissão), `procedures`, e tentativas de acesso negadas. Campos obrigatórios: `actor_id`, `timestamp UTC`, `tenant_id`, `entity`, `field`, `old_value`, `new_value`, `reason`, `ip`, `user_agent`.              |
| III. Isolamento Multi-Tenant                        | PASS   | `tenant_id UUID NOT NULL` em toda tabela de tenant; RLS policy `tenant_id = auth.jwt()->>'tenant_id'::uuid`; UUID PK; middleware Next.js injeta JWT; testes de contrato verificam vazamento impossível. Webhook ingestion via service-role isolada a uma transação com `SET LOCAL app.tenant_id` antes de qualquer escrita. |
| IV. Conformidade TUSS/ANS                           | PASS   | Tabela `tuss_codes` global (read-only para tenants) carregada por script de seed a partir de `github.com/charlesfgarcia/tabelas-ans`. Versões são rastreadas em `tuss_catalog_versions`. Validação de código TUSS em INSERT de `price_versions` e no processamento de atendimento (FR-016).                                 |
| V. Segurança por Perfil de Acesso (RBAC)            | PASS   | Supabase Auth emite JWT com claims `role` (`admin`/`financeiro`/`recepcionista`/`profissional_saude`) e `tenant_id`. Route Handlers verificam role server-side antes de qualquer mutação. RLS policies cruzam `tenant_id` AND `role`. Tentativas negadas gravadas na trilha.                                                |

**Additional domain constraints from constitution (Section 2)** — all addressed:

- Persistência append-only via triggers (R7 em research.md).
- LGPD: campos pessoais criptografados via `pgcrypto` column-level em colunas
  sensíveis de `patients`; logs via `pino` com redaction list.
- GHL integração: assinatura HMAC validada; `event_id` como chave de
  idempotência; segredos armazenados em Vercel env vars + Supabase vault.
- UTC em persistência, BRL em centavos, observabilidade estruturada com
  `tenant_id`, `user_id`, `trace_id`.

**Development Workflow gates from constitution (Section 3)** — plan provides:

- Testes obrigatórios para código financeiro, RBAC e multi-tenant scoping
  (contract + isolation + role matrix) — detalhados em tasks.md (Phase 2).
- Migrações reversíveis em dev via Supabase migration files.
- Constitution Check referenciado em toda PR (este documento é a âncora).

**Result**: **PASS — sem violações; Complexity Tracking vazio.**

## Project Structure

### Documentation (this feature)

```text
specs/001-faturamento-medico-ghl/
├── plan.md                 # This file (/speckit-plan output)
├── spec.md                 # Feature spec (/speckit-specify + /speckit-clarify)
├── research.md             # Phase 0 output (/speckit-plan)
├── data-model.md           # Phase 1 output (/speckit-plan)
├── quickstart.md           # Phase 1 output (/speckit-plan)
├── contracts/              # Phase 1 output (/speckit-plan)
│   ├── webhook-ghl.yaml
│   ├── precos.yaml
│   ├── medicos.yaml
│   ├── atendimentos.yaml
│   ├── relatorios.yaml
│   └── alertas.yaml
├── checklists/
│   └── requirements.md     # Spec quality checklist
└── tasks.md                # Phase 2 output (/speckit-tasks — NOT created here)
```

### Source Code (repository root)

Aplicação web unificada Next.js; schema e policies em `supabase/` na raiz.

```text
src/
├── app/                                # Next.js 14 App Router
│   ├── (auth)/
│   │   └── login/page.tsx
│   ├── (dashboard)/                    # Área autenticada
│   │   ├── layout.tsx
│   │   ├── precos/
│   │   │   ├── page.tsx
│   │   │   └── [id]/page.tsx
│   │   ├── medicos/page.tsx
│   │   ├── atendimentos/
│   │   │   ├── page.tsx
│   │   │   └── [id]/page.tsx
│   │   ├── alertas/page.tsx
│   │   ├── dlq/page.tsx
│   │   └── relatorios/
│   │       └── mensal/page.tsx
│   ├── api/                            # Route Handlers = backend
│   │   ├── webhooks/
│   │   │   └── ghl/route.ts            # Ingestão síncrona (FR-008a)
│   │   ├── workers/
│   │   │   └── process-ghl-event/route.ts  # Consumidor QStash (FR-008b)
│   │   ├── precos/
│   │   │   ├── route.ts                # GET (listar), POST (nova versão)
│   │   │   └── [id]/route.ts
│   │   ├── medicos/route.ts
│   │   ├── atendimentos/
│   │   │   ├── route.ts                # GET lista
│   │   │   └── [id]/
│   │   │       ├── route.ts            # GET detalhe
│   │   │       └── reversal/route.ts   # POST reversão
│   │   ├── relatorios/mensal/
│   │   │   ├── route.ts                # GET JSON
│   │   │   └── export/[formato]/route.ts  # PDF/Excel
│   │   └── alertas/
│   │       ├── route.ts
│   │       └── [id]/resolve/route.ts
│   └── layout.tsx
├── lib/
│   ├── core/                           # Domínio puro (tenant-safe)
│   │   ├── pricing/
│   │   │   ├── resolve-price.ts        # preço vigente por (proc, plano, data)
│   │   │   └── create-version.ts       # com optimistic concurrency
│   │   ├── appointments/
│   │   │   ├── create-from-event.ts
│   │   │   ├── reverse.ts
│   │   │   └── effective-status.ts
│   │   ├── commissions/
│   │   ├── reports/
│   │   │   ├── monthly.ts
│   │   │   ├── export-pdf.tsx          # componentes @react-pdf/renderer
│   │   │   └── export-excel.ts         # exceljs
│   │   ├── audit/
│   │   ├── alerts/
│   │   └── patients/
│   ├── integrations/
│   │   ├── ghl/
│   │   │   ├── verify-signature.ts     # HMAC do secret token do tenant
│   │   │   └── extract-custom-fields.ts
│   │   ├── queue/
│   │   │   ├── qstash-client.ts
│   │   │   └── verify-qstash-signature.ts
│   │   └── email/
│   │       └── resend-client.ts
│   ├── db/
│   │   ├── supabase-browser.ts
│   │   ├── supabase-server.ts          # com RLS (JWT do usuário)
│   │   ├── supabase-service.ts         # service-role (apenas webhook ingestion)
│   │   └── types.ts                    # tipos gerados do schema
│   └── auth/
│       ├── get-session.ts
│       ├── require-role.ts
│       └── rbac.ts
├── components/                         # UI compartilhada
└── styles/

supabase/
├── migrations/                         # SQL numeradas
│   ├── 0001_init_tenant_schema.sql
│   ├── 0002_rls_policies.sql
│   ├── 0003_append_only_triggers.sql
│   ├── 0004_audit_triggers.sql
│   ├── 0005_tuss_catalog.sql
│   ├── 0006_webhook_events.sql
│   ├── 0007_dlq.sql
│   └── 0008_alerts.sql
├── policies/                           # Documentação de cada RLS
├── seed/
│   ├── tuss-import.ts                  # Baixa e importa charlesfgarcia/tabelas-ans
│   └── demo-tenant.sql
└── functions/                          # Edge Functions (se necessário)

tests/
├── contract/                           # Validação contra contracts/*.yaml
│   ├── webhook-ghl.spec.ts
│   ├── precos.spec.ts
│   └── ...
├── integration/
│   ├── tenant-isolation.spec.ts        # Principle III (vazamento impossível)
│   ├── append-only.spec.ts             # Principle I
│   ├── audit-trail.spec.ts             # Principle II
│   ├── rbac-matrix.spec.ts             # Principle V (role × endpoint)
│   ├── webhook-flow.spec.ts
│   └── reversal-flow.spec.ts
├── e2e/                                # Playwright
│   ├── price-change.spec.ts
│   ├── monthly-report-export.spec.ts
│   └── alert-dashboard.spec.ts
└── unit/

scripts/
├── seed-tuss.ts
└── test-qstash-locally.ts
```

**Structure Decision**: Web application monolítico em Next.js 14 App Router,
com backend implementado via Route Handlers sob `src/app/api/*`. Schema de
banco versionado em `supabase/migrations/` com RLS e triggers isolados em
arquivos dedicados para revisão focada. Código de domínio puro (core) em
`src/lib/core` sem dependências do framework web, permitindo testes
isolados. Workers de fila são Route Handlers dedicados em
`src/app/api/workers/*` com verificação de assinatura QStash como gate.

## Complexity Tracking

_Preenchido apenas se o Constitution Check apontar violações justificadas._

**Nenhuma violação detectada no gate inicial.** O plano segue estritamente
os 5 Core Principles sem necessidade de desvio. A única simplificação em
relação à stack originalmente sugerida pelo usuário (remoção do Express em
favor de Next.js unificado) **reduz** complexidade e está documentada em
`research.md` (Decisão R1).

---

_Phase 0 output: [research.md](./research.md) — decisões técnicas e pesquisa._
_Phase 1 output: [data-model.md](./data-model.md), [contracts/](./contracts/), [quickstart.md](./quickstart.md)._
_Phase 2 will be executed by `/speckit-tasks` — not part of this command._
