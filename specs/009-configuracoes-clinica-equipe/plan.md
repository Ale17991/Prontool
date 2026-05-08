# Implementation Plan: Configurações da Clínica, Perfil, Equipe e Reorganização da Navegação

**Branch**: `009-configuracoes-clinica-equipe` | **Date**: 2026-05-08 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/009-configuracoes-clinica-equipe/spec.md`

## Summary

Cinco entregas combinadas numa única feature, todas dentro do shell de dashboard existente do Prontool:

1. **Perfil da clínica (admin)** — nova tabela `tenant_clinic_profile` (1:1 com `tenants`) com logo, dados oficiais (CNPJ + máscara/dígitos verificadores), endereço (com lookup ViaCEP) e responsável técnico. Logo armazenada no novo bucket `clinic-logos` com RLS por tenant. Logo + dados consumidos pelo header da sidebar e por todos os PDFs (`prontuario-pdf`, `anamnesis/export-pdf`, `reports/export-*`). Nada toca o domínio financeiro (preços/atendimentos/auditoria).
2. **Perfil do usuário (todos)** — nova tabela `user_profile` (1:1 com `auth.users`) com nome, foto e fuso horário; bucket `user-avatars`. Troca de senha via `supabase.auth.updateUser({ password })` após reautenticação `signInWithPassword` para validar a senha atual. Avatar substitui as iniciais na sidebar e nos rótulos de autoria.
3. **Gestão de equipe (admin)** — `user_tenants` ganha colunas `status` (`active|disabled`), `disabled_at`, `disabled_by`. Lista, convite, mudança de papel, desativação e reativação via Route Handlers admin-only com `requireRole`. Convite usa Service Role chamando `supabase.auth.admin.createUser({ email, email_confirm: false })` + insert em `user_tenants` + `inviteUserByEmail` para enviar o link de definição de senha. Trigger DB impede desativar/rebaixar a única admin ativa.
4. **Reorganização da sidebar** — `dashboard-shell.tsx` reescrito para 3 seções com itens individuais (Operação / Análise / Configurações), sem barra de abas horizontais. Páginas existentes em `/cadastros/*` movidas para os novos paths; redirects 301 acrescentados em `middleware.ts` no mesmo padrão da rota `/cadastros/medicos` já em produção.
5. **Auditoria transversal** — toda mudança em `tenant_clinic_profile`, `user_tenants.role`/`status`, troca de senha e convite gera linha em `audit_log` (Princípio II), respeitando o shape existente (`actor_id`, `entity`, `field`, `old_value`, `new_value`, `reason`, `ip`, `user_agent`).

Nenhum requisito financeiro (Princípio I) é tocado; nada de TUSS/ANS (Princípio IV); RLS por `tenant_id` (Princípio III) e RBAC (Princípio V) aplicados como gate.

## Technical Context

**Language/Version**: TypeScript 5.4 sobre Node.js 20 LTS (runtime Vercel).
**Primary Dependencies**: Next.js 14.2 (App Router), `@supabase/ssr` 0.5, `@supabase/supabase-js` 2.45 (incluindo `auth.admin` via Service Role), Zod 3.23, Tailwind CSS 3.4, shadcn/ui (Radix), `lucide-react`, `@react-pdf/renderer` 3.4 (já presente — receberá o novo header). **Sem novas deps de runtime** — ViaCEP via `fetch` nativo com `AbortSignal.timeout(3000)`; validação de CNPJ feita por helper puro local; máscaras com `react-input-mask` opcional ou implementação inline (preferível inline para evitar nova dep).
**Storage**: PostgreSQL via Supabase (local `supabase start` :54321) com RLS por `tenant_id`. **Migration nova**: `0064_clinic_profile_and_team_management.sql`. **Tabelas tocadas**: `user_tenants` (acrescenta `status`, `disabled_at`, `disabled_by`); `audit_log` (uso, sem schema change). **Tabelas novas**: `tenant_clinic_profile`, `user_profile`. **Buckets novos**: `clinic-logos` (privado, leitura por mesmo tenant via RLS em `storage.objects`), `user-avatars` (privado, leitura para autenticados do mesmo tenant). Funções DB novas: `is_last_active_admin(tenant_id, user_id)` e trigger `enforce_last_admin` em `user_tenants`.
**Testing**: Vitest. Cobertura obrigatória: contract tests dos endpoints novos (request/response shape), RLS tests (cross-tenant negado em logo, avatar, perfil, lista de usuários), RBAC tests (não-admin recebe 403 em `/api/configuracoes/clinica` e `/api/configuracoes/usuarios/*`), integration tests do convite (mock `auth.admin`) e do trigger "última admin".
**Target Platform**: Web app SSR/CSR no Vercel; sidebar e páginas de configurações renderizam em desktop e mobile (drawer já existente).
**Project Type**: web (frontend + backend monolítico em Next.js).
**Performance Goals**: render inicial das páginas < 800 ms p95; upload de logo/avatar até 2 MB conclui em < 3 s p95 em conexão 10 Mbps; consulta CEP retorna em < 1.5 s p95 incluindo cache; lista de usuários carrega em < 500 ms para até 100 membros (escala atual de tenant).
**Constraints**: limite duro de 2 MB por imagem validado em `Content-Length` + sniff binário (magic bytes JPG/PNG); ViaCEP é "best-effort" — falha não bloqueia salvamento; trocas de senha usam `signInWithPassword` na **mesma sessão** para validar atual antes do `updateUser`; nenhuma rota de configuração executa mais de uma escrita SQL em transações ad-hoc — alterações compostas (mudar role + auditar) usam o padrão existente "insert audit_log no mesmo handler" sem savepoint.
**Scale/Scope**: até 100 usuários ativos por tenant; até 50 convites pendentes simultâneos; logo até 2 MB; foto até 2 MB; lista de usuários paginada apenas se exceder 100; auditoria mantém histórico ilimitado (append-only).

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Aplicabilidade | Status | Justificativa |
|-----------|----------------|--------|---------------|
| I. Integridade Financeira Imutável | **N/A** | ✅ Pass | Feature não toca preços, faturas, atendimentos ou estornos. Nenhum `UPDATE`/`DELETE` em tabela financeira. |
| II. Auditabilidade Total | **Aplica** | ✅ Pass | Cada mutação relevante (clinic profile, role change, convite, desativação, reativação, troca de senha) escreve em `audit_log` no mesmo handler, com `actor_id`, `entity`, `field`, `old/new`, `reason`, `ip`, `user_agent`. Senha **NÃO** é logada — apenas o evento `user_profile.password.changed` com timestamp. |
| III. Isolamento Multi-Tenant | **Aplica** | ✅ Pass | `tenant_clinic_profile` carrega `tenant_id` PRIMARY KEY, RLS `USING/WITH CHECK (tenant_id = jwt_tenant_id())`. `user_profile` é por `user_id` mas a leitura cross-user dentro do mesmo tenant é restrita à exibição de avatar (policy específica). Buckets `clinic-logos` e `user-avatars` aplicam RLS via `(storage.foldername(name))[1] = jwt_tenant_id()::text`. |
| IV. Conformidade TUSS/ANS | **N/A** | ✅ Pass | Nenhuma cobrança ou catálogo TUSS afetado. |
| V. RBAC | **Aplica** | ✅ Pass | `/configuracoes/clinica` e `/configuracoes/usuarios/*` exigem `role === 'admin'` via `requireRole`. `/configuracoes/perfil` aceita qualquer role autenticado. Mudança de papel exige admin do mesmo tenant. Trigger DB `enforce_last_admin` impede admin único de se desativar/rebaixar. |

**Gate decision**: PASS. Nenhuma violação a justificar em Complexity Tracking.

## Project Structure

### Documentation (this feature)

```text
specs/009-configuracoes-clinica-equipe/
├── plan.md              # Este arquivo (/speckit.plan)
├── research.md          # Phase 0 (/speckit.plan)
├── data-model.md        # Phase 1 (/speckit.plan)
├── quickstart.md        # Phase 1 (/speckit.plan)
├── contracts/           # Phase 1 (/speckit.plan)
│   ├── clinic-profile.md
│   ├── user-profile.md
│   ├── team-management.md
│   └── viacep.md
└── tasks.md             # Phase 2 (/speckit.tasks — gerado depois)
```

### Source Code (repository root)

```text
src/
├── app/
│   ├── (dashboard)/
│   │   ├── _components/
│   │   │   ├── dashboard-shell.tsx               # REESCRITO: 3 seções, sem tabs horizontais
│   │   │   └── sidebar-clinic-logo.tsx           # NOVO: server component que injeta logo
│   │   ├── operacao/                             # Inalterado (Atendimentos→Agenda só rótulo)
│   │   ├── analise/
│   │   │   └── despesas/                         # MOVIDO de /cadastros/despesas
│   │   ├── configuracoes/
│   │   │   ├── page.tsx                          # Landing redireciona p/ /configuracoes/clinica (admin) ou /configuracoes/perfil
│   │   │   ├── clinica/page.tsx                  # NOVO (admin)
│   │   │   ├── perfil/page.tsx                   # NOVO (qualquer role)
│   │   │   ├── usuarios/page.tsx                 # NOVO (admin)
│   │   │   ├── procedimentos/                    # MOVIDO de /cadastros/procedimentos
│   │   │   ├── convenios/                        # MOVIDO de /cadastros/planos (rename rota)
│   │   │   ├── profissionais/                    # MOVIDO de /cadastros/profissionais
│   │   │   ├── modelos-anamnese/                 # MOVIDO de /cadastros/anamnese
│   │   │   └── integracoes/                      # Permanece (Feature 002/008)
│   │   └── cadastros/                            # REMOVIDO — todas as rotas migram + 301 no middleware
│   └── api/
│       └── configuracoes/
│           ├── clinica/
│           │   ├── route.ts                      # GET, PUT (admin)
│           │   └── logo/route.ts                 # POST upload, DELETE remove (admin)
│           ├── perfil/
│           │   ├── route.ts                      # GET, PUT (auth)
│           │   ├── avatar/route.ts               # POST upload, DELETE remove (auth)
│           │   └── senha/route.ts                # POST troca de senha (auth)
│           ├── usuarios/
│           │   ├── route.ts                      # GET lista (admin)
│           │   ├── convite/route.ts              # POST convite (admin)
│           │   └── [userId]/
│           │       ├── route.ts                  # PATCH role (admin)
│           │       └── status/route.ts           # PATCH ativar/desativar (admin)
│           └── cep/[cep]/route.ts                # GET ViaCEP proxy (cache 24h, auth)
├── lib/
│   ├── core/
│   │   ├── clinic-profile/
│   │   │   ├── read.ts                           # Busca perfil completo do tenant atual
│   │   │   ├── update.ts                         # Update + audit_log
│   │   │   ├── upload-logo.ts                    # Service-role upload + URL signed
│   │   │   └── validate-cnpj.ts                  # Helper puro (formato + dígitos)
│   │   ├── user-profile/
│   │   │   ├── read.ts
│   │   │   ├── update.ts                         # Nome, fuso (com audit)
│   │   │   ├── upload-avatar.ts
│   │   │   └── change-password.ts                # signInWithPassword + updateUser + audit
│   │   └── team/
│   │       ├── list.ts                           # Junta user_tenants + auth.admin.listUsers
│   │       ├── invite.ts                         # auth.admin.createUser + inviteUserByEmail + insert
│   │       ├── set-role.ts                       # Update + audit + check last-admin
│   │       ├── set-status.ts                     # active|disabled + audit + check last-admin
│   │       └── reactivate.ts                     # Reseta status (sem novo convite)
│   └── pdf/
│       └── clinic-header.tsx                     # NOVO: componente compartilhado por todos os PDFs
├── middleware.ts                                 # ALTERADO: adiciona 301 das 5 rotas de cadastros
└── components/
    └── ui/                                       # shadcn já tem Card, Button, Input, etc.

supabase/
└── migrations/
    └── 0064_clinic_profile_and_team_management.sql  # NOVO

tests/
├── contract/
│   ├── api-configuracoes-clinica.test.ts
│   ├── api-configuracoes-perfil.test.ts
│   └── api-configuracoes-usuarios.test.ts
├── integration/
│   ├── clinic-profile-rls.test.ts
│   ├── user-profile-rls.test.ts
│   ├── team-invite-flow.test.ts
│   ├── last-admin-trigger.test.ts
│   └── cadastros-redirects-301.test.ts
└── unit/
    ├── validate-cnpj.test.ts
    └── pdf-clinic-header.test.tsx
```

**Structure Decision**: Web monolítica Next.js — backend (Route Handlers) e frontend (Client Components + Server Components do App Router) coabitam em `src/`. Lógica de domínio fica em `src/lib/core/<área>` e endpoints em `src/app/api/configuracoes/<recurso>/route.ts`, padrão já estabelecido pelas features 005–008.

## Complexity Tracking

> Sem violações. Tabela vazia.

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| — | — | — |
