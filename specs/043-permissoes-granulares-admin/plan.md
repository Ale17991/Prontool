# Implementation Plan: Permissões granulares por usuário + autonomia de super-admin

**Branch**: `043-permissoes-granulares-admin` | **Date**: 2026-06-26 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/043-permissoes-granulares-admin/spec.md`

## Summary

Duas frentes sobre o RBAC e a gestão de usuários existentes:

1. **Overrides por usuário** — nova tabela `user_permission_overrides (tenant_id, user_id, action, effect grant|deny)`. A checagem de autorização passa a considerar papel + overrides (permissão efetiva = `MATRIX[role] ∪ grants \ denies`), avaliada **no servidor**. UI de edição em `/configuracoes/usuarios` (admin da clínica), com aviso ao conceder ações sensíveis.
2. **Autonomia de super-admin** no `/admin` — gerenciar usuários de qualquer clínica (CRUD + papel), resetar senha, editar dados cadastrais da clínica e impersonar **somente-leitura** (banner + auditoria início/fim). Reusa os fluxos existentes (`createManualUser`, convite, reset, `tenant_clinic_profile`, `enforce_last_admin`), agora cross-tenant e auditados.

## Technical Context

**Language/Version**: TypeScript 5.4 / Node.js 20 LTS (runtime Vercel)
**Primary Dependencies**: Next.js 14.2 (App Router, RSC, Server Actions, Route Handlers), `@supabase/ssr` 0.5 / `@supabase/supabase-js` 2.45, Zod 3.23, Tailwind 3.4, shadcn/ui. **Sem novas deps.**
**Storage**: PostgreSQL via Supabase, RLS por `tenant_id`. **Migration nova**: `0163_user_permission_overrides.sql`. **Tabela nova**: `user_permission_overrides`. **Tabelas tocadas (uso)**: `audit_log`, `user_tenants` (papel/status — já existe), `tenant_clinic_profile` (edição pelo /admin). **Funções existentes reusadas**: `enforce_last_admin`, `log_audit_event`.
**Testing**: vitest — unit (`canUser`/permissão efetiva: grant, deny vence, no-op), integration (autorização em endpoint com override; isolamento por tenant das ações cross-tenant; proteção do último admin).
**Target Platform**: Web app SSR (Vercel) + Supabase.
**Project Type**: Web application (Next.js App Router single-package).
**Performance Goals**: overrides carregados 1× por request/render (tabela pequena, índice `(tenant_id, user_id)`); impacto desprezível. Mudança de override vale imediatamente (sem esperar refresh de JWT).
**Constraints**: autorização server-side autoritativa; isolamento multi-tenant; auditoria de tudo (incl. negações); último admin protegido.
**Scale/Scope**: 1 tabela nova, 1 migration, refactor da camada de `can`/`requireRole`, UI de overrides em /configuracoes/usuarios, ~4 ações no /admin (gestão usuário, reset, editar clínica, impersonar read-only).

## Constitution Check

_GATE: Must pass before Phase 0 research. Re-check after Phase 1 design._

- **I. Integridade Financeira Imutável** — ✅ Não altera registros financeiros. Overrides são config (tabela mutável própria); audit em append-only.
- **II. Auditabilidade de Preços** — ✅ A feature adiciona auditoria de mudanças de permissão/usuário (reforça II). Toda concessão/revogação é auditada (ator/alvo/antes-depois/motivo).
- **III. Isolamento Multi-Tenant** — ✅ `user_permission_overrides` carrega `tenant_id` e é filtrada por ele; RLS por tenant; ações cross-tenant do super-admin validam o `tenant_id` alvo antes de qualquer efeito e auditam com o tenant alvo.
- **IV. Conformidade TUSS/ANS** — ✅ Não toca catálogo/preço/TISS.
- **V. Segurança por Perfil de Acesso (RBAC)** — ✅ **RESOLVIDO** (decisão do stakeholder, 2026-06-26): as ações financeiras-críticas protegidas pelo Princípio V — `price.write`, `commission.write`, `appointment.reverse`, `audit.read`, `audit.export` — são **NÃO-overridáveis** (a UI nem oferece; o servidor rejeita tentativa de override sobre elas). Honra a letra de V sem emenda. As demais ações são overridáveis (sensíveis com aviso). Autorização 100% server-side.

**Resultado**: PASS. Sem violações em aberto. A separação de funções financeira do Princípio V é preservada (ações críticas continuam atadas ao papel); a autonomia recai sobre as ações não-críticas.

## Project Structure

### Documentation (this feature)

```text
specs/043-permissoes-granulares-admin/
├── plan.md            # Este arquivo
├── spec.md            # Especificação (+ Clarifications)
├── research.md        # Phase 0 — decisões técnicas
├── data-model.md      # Phase 1 — tabela de overrides + permissão efetiva
├── quickstart.md      # Phase 1 — cenários de verificação
├── contracts/
│   └── authz.md       # Contrato de autorização (canUser) + ações
└── checklists/requirements.md
```

### Source Code (repository root)

```text
src/lib/auth/
├── rbac.ts                       # + canUser(role, overrides, action); MATRIX inalterada
├── overrides.ts (novo)           # tipos + getUserOverrides + computeEffective
├── require-role.* / requireRole  # carrega overrides do ator e autoriza com canUser
└── get-session.ts                # (sem mudança de claims; overrides vêm do DB)

src/lib/core/team/
├── permission-overrides/ (novo)  # set/list overrides (admin do tenant ou super-admin) + audit
└── (reusa) create-manual, invite, change-role, status

src/app/(dashboard)/configuracoes/usuarios/
├── users-panel.tsx / row-actions # + ação "Permissões"
└── permissions-dialog.tsx (novo) # editar overrides do usuário (aviso em ação sensível)

src/app/api/configuracoes/usuarios/[userId]/permissions/route.ts (novo)

src/app/admin/clinicas/[id]/
├── clinic-detail.tsx             # + Usuários (CRUD+papel+reset), Dados da clínica, Entrar (read-only)
└── (admin actions)               # cross-tenant, super-admin, auditadas

supabase/migrations/
└── 0163_user_permission_overrides.sql

tests/
├── unit/ (canUser: grant/deny/no-op)
└── integration/ (authz com override; isolamento cross-tenant; último admin)
```

**Structure Decision**: App Next.js single-package. O núcleo de segurança é estender a camada de autorização (`canUser` + carga de overrides no servidor por request) sem mudar o vocabulário de Actions. Overrides são fonte da verdade no DB (valem imediatamente; não dependem de refresh de JWT). UI nunca é mecanismo de segurança.

## Complexity Tracking

> Itens que exigem justificativa/decisão antes da implementação:

| Item                                                      | Por que existe                                                                                                                              | Decisão necessária / mitigação                                                                                                                       |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Override de ações financeiras-críticas vs Princípio V** | "Todas overridáveis" permitiria conceder `price.write`/`commission.write`/`appointment.reverse`/`audit.*` a papéis que o Princípio V proíbe | **RESOLVIDO (2026-06-26)**: essas ações são NÃO-overridáveis (protegidas). Honra a constituição sem emenda. Overrides valem só para as demais ações. |
| Impersonação read-only                                    | Super-admin atuando dentro do tenant                                                                                                        | Mitigado: somente-leitura (bloqueia escrita no servidor durante a impersonação), banner visível, auditoria início/fim, escopo de tenant validado.    |
| Carga de overrides por request                            | Autorização precisa ser imediata (não via JWT stale)                                                                                        | 1 query indexada por `(tenant_id,user_id)`; set efetivo 1×/request. Custo desprezível; evita staleness.                                              |
