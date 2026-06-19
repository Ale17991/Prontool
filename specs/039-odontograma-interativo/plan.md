# Implementation Plan: Odontograma Interativo (Módulo Odontológico — Fase 1)

**Branch**: `039-odontograma-interativo` | **Date**: 2026-06-19 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/039-odontograma-interativo/spec.md`

## Summary

Entregar o registro clínico do estado dentário via um **odontograma interativo** em SVG (notação FDI), embutido como uma nova aba no prontuário do paciente. O profissional seleciona um status numa **paleta** e clica em dentes/faces para aplicá-lo ("paleta + pintar"); a cor/aparência muda na hora. Cada marcação é um registro **append-only** auditado, com nota opcional, isolado por tenant e vinculável a um atendimento. O conjunto de status (rótulo, cor, ícone, escopo dente/face, código TUSS tabela 22) é um **catálogo global de plataforma** administrável pelo super-admin em `/admin`, semeado com um conjunto padrão.

Abordagem técnica: reaproveitar integralmente os padrões existentes — migration com RLS por tenant + triggers append-only/auditoria (como `appointment_materials`/`patient_measurements`), core em `src/lib/core/`, rotas `requireRole`/`requireSuperAdmin` com `createSupabaseServiceClient`, e UI com a aba do prontuário (`patient-detail-layout.tsx`). Sem novas dependências de runtime — odontograma é SVG/React puro.

## Technical Context

**Language/Version**: TypeScript 5.4 sobre Node.js 20 LTS (runtime Vercel)
**Primary Dependencies**: Next.js 14.2 (App Router, RSC, Route Handlers), `@supabase/ssr` 0.5 / `@supabase/supabase-js` 2.45, Zod 3.23, Tailwind CSS 3.4, shadcn/ui (Radix), `lucide-react`. **Sem novas deps** — odontograma renderizado em SVG inline.
**Storage**: PostgreSQL via Supabase (local: `supabase start` :54321) com RLS por `tenant_id`. **Migration nova**: `0134_odontogram.sql`. **Tabelas novas**: `dental_status_catalog` (global, sem tenant_id — padrão `tuss_codes`), `dental_chart_entries` (per-tenant, append-only). **RPC nova**: `dental_chart_current(p_tenant_id, p_patient_id)` (DEFINER) — estado atual por posição. **Tabelas tocadas (uso)**: `tuss_codes` (leitura, `tuss_table='22'`), `audit_log` (via `log_audit_event`).
**Testing**: Vitest (`pnpm test`, `pnpm test:integration`, `pnpm test:contract`), `pnpm lint:auth`, `pnpm supabase:reset`
**Target Platform**: Web app SSR (Vercel) + navegadores modernos
**Project Type**: Web application (Next.js App Router monorepo single-app)
**Performance Goals**: Feedback visual da marcação percebido como instantâneo (<1s; via atualização otimista no cliente). Carregamento do estado atual do odontograma de um paciente sem percepção de espera.
**Constraints**: Append-only nas marcações; isolamento estrito por tenant; catálogo global read-only para tenants. Sem novas dependências.
**Scale/Scope**: 52 posições (32 permanentes + 20 decíduos) × 5 faces por paciente; histórico cresce por evento mas volume por paciente é modesto. ~1 migration, ~3 tabelas/RPC, ~8 arquivos core, ~5 rotas, ~1 aba de UI + 1 página admin.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- **I. Integridade Financeira Imutável (NON-NEGOTIABLE)**: Sem valores financeiros nesta feature. Princípio aplicado por analogia: `dental_chart_entries` é **append-only** (trigger `enforce_append_only_columns('')`, sem UPDATE/DELETE). Correção = novo registro. ✅ PASS
- **II. Auditabilidade Total (NON-NEGOTIABLE)**: Cada INSERT de marcação dispara `log_audit_event` (ator via `session_uuid('app.actor_id')`, tenant, entidade, status). Mutações do catálogo global são ação de plataforma (sem `tenant_id`) — registradas via colunas `created_by`/`updated_by` na tabela; não usam o `audit_log` por-tenant (decisão D2 em research.md). ✅ PASS
- **III. Isolamento Multi-Tenant**: `dental_chart_entries` carrega `tenant_id` obrigatório, RLS `tenant_id = jwt_tenant_id()`, triggers de consistência paciente↔tenant e atendimento↔tenant, PK UUID. Catálogo é **referência global** (igual `tuss_codes`): sem `tenant_id`, read-only para `authenticated`, escrita só service-role. ✅ PASS
- **IV. Conformidade TUSS/ANS**: Catálogo de status referencia `tuss_codes` (tabela 22, procedimentos) — reusa catálogo versionado, não reinventa códigos. Associação opcional. ✅ PASS
- **V. Segurança por Perfil (RBAC)**: Escrita de marcações restrita server-side a `admin` + `profissional_saude` (`requireRole`). Administração do catálogo restrita a super-admin (`requireSuperAdmin`). Controle no servidor, não só UI. ✅ PASS

**Resultado**: Sem violações. Complexity Tracking vazio.

## Project Structure

### Documentation (this feature)

```text
specs/039-odontograma-interativo/
├── plan.md              # Este arquivo
├── research.md          # Phase 0
├── data-model.md        # Phase 1
├── quickstart.md        # Phase 1
├── contracts/           # Phase 1 (REST + RPC)
│   ├── odontograma-api.md
│   └── dental-status-admin-api.md
└── tasks.md             # Phase 2 (/speckit.tasks — NÃO criado aqui)
```

### Source Code (repository root)

```text
supabase/migrations/
└── 0134_odontogram.sql          # catálogo global + entries append-only + RPC + RLS + triggers + seed

src/lib/core/dental/
├── teeth.ts                     # constantes FDI (permanente/decíduo), faces, validação de posição
├── status-catalog/
│   ├── list.ts                  # lista catálogo (ativos p/ tenant; todos p/ admin)
│   ├── create.ts                # cria status (admin)
│   └── update.ts                # edita/ativa/desativa status (admin)
└── chart/
    ├── create-entry.ts          # insere marcação append-only
    ├── list-current.ts          # estado atual via RPC dental_chart_current
    └── list-history.ts          # histórico por posição

src/app/api/
├── pacientes/[id]/odontograma/route.ts          # GET (estado atual + catálogo) / POST (marcação)
├── dental-status/route.ts                       # GET catálogo ativo (authenticated)
└── admin/dental-status/
    ├── route.ts                                 # GET (todos) / POST (criar) — super-admin
    └── [id]/route.ts                            # PATCH (editar/ativar/desativar) — super-admin

src/app/(dashboard)/operacao/pacientes/[id]/_components/odontogram/
├── odontogram-tab.tsx           # wrapper da aba (server data → client)
├── odontogram-chart.tsx         # SVG da carta dentária (client)
├── tooth.tsx                    # SVG de 1 dente com 5 faces clicáveis
└── status-palette.tsx           # paleta de status selecionável

src/app/admin/catalogo/status-odontologicos/
├── page.tsx                     # lista + gestão (SSR, service client, requireSuperAdmin)
├── status-form.tsx              # form criar/editar (client)
└── status-table.tsx             # tabela do catálogo (client)

tests/
├── contract/dental-status-catalog.test.ts       # imutabilidade catálogo/append-only entries
├── integration/odontogram-tenant-isolation.test.ts
└── integration/odontogram-rbac.test.ts
```

**Structure Decision**: Web application single-app (App Router). A feature segue o layering canônico do projeto: migration → `src/lib/core/dental/*` (lógica pura) → Route Handlers (`requireRole`/`requireSuperAdmin` + `createSupabaseServiceClient`) → UI (aba no prontuário + página `/admin`). O odontograma vive como nova aba dentro de `patient-detail-layout.tsx` (mesmo padrão de Evolução/Clínico/Cadastro). O catálogo administrável fica sob `/admin/catalogo/` (super-only), espelhando o padrão de CRUD de `taxes` porém gated por `requireSuperAdmin`.

## Complexity Tracking

> Sem violações da Constitution Check — nada a justificar.
