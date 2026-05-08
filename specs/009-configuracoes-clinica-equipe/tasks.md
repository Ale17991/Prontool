---
description: "Task list for feature 009 — Configurações da Clínica, Perfil, Equipe e Reorganização da Navegação"
---

# Tasks: Configurações da Clínica, Perfil, Equipe e Reorganização da Navegação

**Input**: Design documents from `/specs/009-configuracoes-clinica-equipe/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md

**Tests**: Tests are INCLUDED. Constituição §"Fluxo de Desenvolvimento" exige cobertura para mudanças que tocam RBAC, isolamento multi-tenant e auditoria — toda esta feature toca pelo menos um desses pontos.

**Organization**: Tasks são agrupadas por user story. Cada story (US1–US4) é independentemente testável e entrega valor isolado.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Pode rodar em paralelo (arquivo distinto, sem dependência pendente)
- **[Story]**: US1 (P1 clínica), US2 (P2 navegação), US3 (P3 perfil), US4 (P4 equipe)

## Path Conventions

- **Web app monolítica Next.js** (App Router): tudo sob `src/`. Migrations em `supabase/migrations/`. Testes em `tests/{contract,integration,unit}`.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: garantir ambiente local pronto. Sem dependência de design.

- [X] T001 Verificar pré-requisitos locais executando `supabase start` e `pnpm install` no repositório raiz; confirmar que `pnpm typecheck` e `pnpm lint:auth` rodam limpos antes de começar a feature

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: schema, buckets, triggers e helpers compartilhados por US1, US3 e US4. US2 não depende destas tarefas, mas por simplicidade roda na mesma fase para liberar todas as stories ao mesmo tempo.

**⚠️ CRITICAL**: nenhuma story pode iniciar antes desta fase concluir.

- [X] T002 Criar migration `supabase/migrations/0064_clinic_profile_and_team_management.sql` com (a) tabelas `tenant_clinic_profile` e `user_profile` conforme `data-model.md` §1 e §2, (b) ALTER em `user_tenants` adicionando `status`, `disabled_at`, `disabled_by` + índice parcial `user_tenants_active_admin_idx`, (c) função `is_last_active_admin(p_tenant_id, p_user_id)` e trigger `enforce_last_admin` BEFORE UPDATE em `user_tenants`, (d) políticas RLS para as duas tabelas novas, (e) buckets `clinic-logos` e `user-avatars` em `storage.buckets` + policies por path `(storage.foldername(name))[1]`, (f) trigger `touch_updated_at` reusada nas duas tabelas
- [X] T003 Atualizar a função `auth.jwt_custom_claims_hook` (criada na migration 0019) dentro de `0064_clinic_profile_and_team_management.sql` para projetar `tenant_id`/`role` apenas quando `user_tenants.status = 'active'` (research.md R15) — mantendo `CREATE OR REPLACE FUNCTION` para idempotência
- [X] T004 Aplicar migrations localmente com `pnpm supabase:reset` e validar que 0064 foi aplicada inspecionando `select * from public.tenant_clinic_profile limit 0;` e `select * from storage.buckets where id in ('clinic-logos','user-avatars');`
- [X] T005 Regerar tipos TypeScript executando `pnpm supabase:gen-types`, sobrescrevendo `src/lib/db/generated/database.ts` com as definições de `tenant_clinic_profile`, `user_profile` e novas colunas de `user_tenants`
- [X] T006 [P] Criar helper puro `src/lib/core/clinic-profile/validate-cnpj.ts` exportando `isValidCnpj(input: string): boolean` (algoritmo módulo 11 com pesos `[5,4,3,2,9,8,7,6,5,4,3,2]` e `[6,5,4,3,2,9,8,7,6,5,4,3,2]`) e `formatCnpj(digits: string): string` para máscara `00.000.000/0000-00`
- [X] T007 [P] Criar helper `src/lib/utils/image-magic-bytes.ts` exportando `sniffImageType(buffer: ArrayBuffer): 'jpg' | 'png' | null` que lê os primeiros 16 bytes e checa as assinaturas JPG (`FF D8 FF`) e PNG (`89 50 4E 47 0D 0A 1A 0A`)
- [X] T008 [P] Criar helper `src/lib/core/storage/signed-url.ts` exportando `createSignedUrlOrNull(supabase, bucket, path, ttlSeconds)` para reuso por US1, US3 e US4 (encapsula `supabase.storage.from(bucket).createSignedUrl` com tratamento de erro retornando `null`)

**Checkpoint**: schema, buckets, RLS, trigger e helpers prontos. US1, US2, US3 e US4 podem iniciar (em paralelo se houver capacidade de equipe).

---

## Phase 3: User Story 1 — Identidade visual e dados oficiais da clínica (Priority: P1) 🎯 MVP

**Goal**: admin cadastra logo + dados da clínica + responsável técnico; logo passa a aparecer no topo da sidebar e no cabeçalho de todos os PDFs (prontuário, anamnese, relatórios financeiros).

**Independent Test**: cadastrar uma clínica nova, fazer upload de logo, preencher dados e gerar um PDF de prontuário — cabeçalho deve trazer logo + razão social + CNPJ + responsável técnico, e a sidebar deve exibir a logo (quickstart §2).

### Tests for User Story 1

- [ ] T009 [P] [US1] Contract test `tests/contract/api-configuracoes-clinica.test.ts` cobrindo GET/PUT (sucesso, 401 sem auth, 403 não-admin, 400 cnpj inválido, 200 partial update) e POST/DELETE de logo (200, 400 magic-byte mismatch, 413 > 2 MB) conforme `contracts/clinic-profile.md`
- [ ] T010 [P] [US1] Integration RLS test `tests/integration/clinic-profile-rls.test.ts` criando dois tenants com perfis distintos e provando que tenant A não lê (`select`) nem escreve (`update`) o perfil de B; também valida o bucket `clinic-logos` (path `<tenant_b>/logo.png` invisível ao tenant A)
- [ ] T011 [P] [US1] Contract test `tests/contract/api-configuracoes-cep.test.ts` para o proxy ViaCEP — sucesso (mock `fetch`), CEP inexistente (`{ erro: true }` upstream), timeout (`AbortSignal`), 400 para CEP malformado, conforme `contracts/viacep.md`
- [ ] T012 [P] [US1] Unit test `tests/unit/validate-cnpj.test.ts` cobrindo CNPJs válidos clássicos (`04.252.011/0001-10`, `00.000.000/0001-91`), inválidos (todos os mesmos dígitos, dígito verificador errado, comprimento errado) e a máscara `formatCnpj`

### Implementation for User Story 1

- [ ] T013 [P] [US1] Implementar `src/lib/core/clinic-profile/read.ts` exportando `getClinicProfile(supabase, tenantId)` que retorna a row de `tenant_clinic_profile` (ou cria via INSERT ... ON CONFLICT DO NOTHING e relê) acompanhada de `signedLogoUrl` (TTL 24 h) via `createSignedUrlOrNull`
- [ ] T014 [P] [US1] Implementar `src/lib/core/clinic-profile/update.ts` exportando `updateClinicProfile(supabase, tenantId, actorId, patch)` que (a) valida com Zod, (b) chama `isValidCnpj` se cnpj presente, (c) faz UPDATE seletivo, (d) gera uma linha em `audit_log` por campo alterado (`entity='tenant_clinic_profile'`, `field=<col>`, `old/new`), (e) retorna o perfil atualizado
- [ ] T015 [P] [US1] Implementar `src/lib/core/clinic-profile/upload-logo.ts` exportando `uploadClinicLogo(supabaseService, tenantId, actorId, file)` que (a) valida `Content-Length` ≤ 2 MB, (b) lê primeiros 16 bytes e chama `sniffImageType`, (c) faz `storage.from('clinic-logos').upload({tenant_id}/logo.{ext}, {upsert:true})`, (d) atualiza `tenant_clinic_profile.logo_path` e `logo_uploaded_at`, (e) audit `entity='tenant_clinic_profile', field='logo'`
- [ ] T016 [US1] Implementar Route Handler `src/app/api/configuracoes/clinica/route.ts` com handlers `GET` (chama `getClinicProfile`) e `PUT` (chama `updateClinicProfile`); ambos protegidos por `requireRole('admin')` e usando `getSession` para `tenantId` e `actorId` (depende de T013, T014)
- [ ] T017 [US1] Implementar Route Handler `src/app/api/configuracoes/clinica/logo/route.ts` com `POST` (multipart, chama `uploadClinicLogo`) e `DELETE` (remove do storage + zera colunas + audit), `requireRole('admin')` (depende de T015)
- [ ] T018 [US1] Implementar Route Handler `src/app/api/configuracoes/cep/[cep]/route.ts` com `GET` que (a) valida `cep` regex `^[0-9]{8}$` (400 caso contrário), (b) faz `fetch('https://viacep.com.br/ws/{cep}/json/', { signal: AbortSignal.timeout(3000) })`, (c) mapeia resposta conforme `contracts/viacep.md`, (d) retorna `200` com `Cache-Control: public, s-maxage=86400, stale-while-revalidate=604800`
- [ ] T019 [P] [US1] Criar Server Component `src/app/(dashboard)/configuracoes/clinica/page.tsx` que verifica `requireRole('admin')`, busca perfil atual via `getClinicProfile`, e renderiza o card title + `<ClinicProfileForm initial={profile} />`
- [ ] T020 [P] [US1] Criar Client Component `src/app/(dashboard)/configuracoes/clinica/clinic-profile-form.tsx` com upload de logo (input file + preview), campos de razão social/CNPJ (máscara via `formatCnpj`, validação `isValidCnpj` em onBlur)/telefone/email/endereço (com debounced ViaCEP lookup quando CEP completar 8 dígitos)/responsável técnico, e botão Salvar disparando `PUT /api/configuracoes/clinica`
- [ ] T021 [P] [US1] Criar componente compartilhado `src/lib/pdf/clinic-header.tsx` (React-PDF) recebendo `{ profile: ClinicProfile | null, signedLogoUrl: string | null }` e renderizando logo (se disponível) + razão social + CNPJ + endereço + responsável técnico; quando `profile` é null, renderiza aviso "Configure os dados da clínica em Configurações > Clínica" (FR-011)
- [ ] T022 [US1] Modificar `src/lib/core/patient-medical/assemble-prontuario.ts` para incluir `clinicProfile` e `signedLogoUrl` no `ProntuarioBundle` (busca via `getClinicProfile` no service-role client)
- [ ] T023 [US1] Modificar `src/lib/core/patient-medical/prontuario-pdf.tsx` substituindo o bloco `{/* Header */}` (linhas 238–246 atuais) pelo `<ClinicHeader profile={bundle.clinicProfile} signedLogoUrl={bundle.signedLogoUrl} />`
- [ ] T024 [US1] Aplicar a mesma substituição de header em `src/lib/core/anamnesis/export-pdf.tsx`, propagando o profile via parâmetro de assemble
- [ ] T025 [US1] Aplicar a mesma substituição de header em `src/lib/core/reports/export-pdf.tsx`, `src/lib/core/reports/export-financial-pdf.tsx` e `src/lib/core/reports/export-by-plan-pdf.tsx`
- [ ] T026 [US1] Criar Server Component `src/app/(dashboard)/_components/sidebar-clinic-logo.tsx` que recebe `clinicLogoUrl` e `clinicName` como props e retorna o markup de logo + nome (com fallback para o ícone Stethoscope quando logo é null)
- [ ] T027 [US1] Modificar `src/app/(dashboard)/layout.tsx` para buscar `clinicProfile` via `getClinicProfile` no SSR e passar `clinicLogoUrl` + `clinicName` como props para `<DashboardShell>` (pode ler do `tenants.name` como fallback)
- [ ] T028 [US1] Modificar o cabeçalho de `src/app/(dashboard)/_components/dashboard-shell.tsx` (atualmente linhas 299–304) para aceitar e renderizar `clinicLogoUrl`/`clinicName` via `<SidebarClinicLogo>` em vez do markup hardcoded "Stethoscope + Prontool"

**Checkpoint**: US1 completa — admin configura clínica, logo entra na sidebar e em todos os PDFs.

---

## Phase 4: User Story 2 — Sidebar reorganizada e fim das abas horizontais (Priority: P2)

**Goal**: sidebar passa a ter 3 grupos (Operação / Análise / Configurações) com itens individuais clicáveis; barra de abas horizontais é removida; rotas de cadastros migram para `/configuracoes/*` ou `/analise/despesas` com 301.

**Independent Test**: depois do refactor, qualquer link antigo `/cadastros/...` responde 301 para o destino novo, e a área útil de conteúdo das páginas afetadas não tem mais `<div>` de tabs no topo (quickstart §3).

### Tests for User Story 2

- [ ] T029 [P] [US2] Integration test `tests/integration/cadastros-redirects-301.test.ts` fazendo `fetch` (sem follow) para os 5 paths antigos (`/cadastros/procedimentos`, `/cadastros/planos`, `/cadastros/profissionais`, `/cadastros/anamnese`, `/cadastros/despesas`) e validando status 301 + header `Location` correto, preservando query string (`?foo=bar`)
- [ ] T030 [P] [US2] Snapshot test `tests/unit/dashboard-shell.test.tsx` renderizando o shell com cada role (admin/financeiro/recepcionista/profissional_saude) e validando a lista de itens da sidebar — admin vê tudo, recepcionista vê só Meu Perfil dentro de Configurações, e nenhum render produz `<div>` com classe contendo `tab-bar` ou `border-b-2` em volta do conteúdo

### Implementation for User Story 2

- [ ] T031 [US2] Reescrever `src/app/(dashboard)/_components/dashboard-shell.tsx`: substituir a estrutura atual `CATEGORIES`/`primaryCategories`/`configCategory` por uma constante `SECTIONS = [{label:'Operação', items:[...]}, {label:'Análise', items:[...]}, {label:'Configurações', items:[...]}]`; remover por completo o bloco `{visibleTabs.length > 0 ? (...) : null}` (linhas 258–270 atuais) e a função `CategoryTab`; cada item de `SECTIONS` vira um `<SidebarLink>` direto; mantém a integração com `clinicLogoUrl`/`clinicName` (US1) e prepara o slot do avatar (US3)
- [ ] T032 [P] [US2] `git mv src/app/(dashboard)/cadastros/procedimentos src/app/(dashboard)/configuracoes/procedimentos` e ajustar imports relativos quebrados
- [ ] T033 [P] [US2] `git mv src/app/(dashboard)/cadastros/planos src/app/(dashboard)/configuracoes/convenios` (também rename de pasta), ajustar imports e renomear referências internas a "Planos" para "Convênios" apenas em rótulos visíveis (não em queries SQL onde a tabela ainda se chama `plans`)
- [ ] T034 [P] [US2] `git mv src/app/(dashboard)/cadastros/profissionais src/app/(dashboard)/configuracoes/profissionais` e ajustar imports
- [ ] T035 [P] [US2] `git mv src/app/(dashboard)/cadastros/anamnese src/app/(dashboard)/configuracoes/modelos-anamnese` e ajustar imports
- [ ] T036 [P] [US2] `git mv src/app/(dashboard)/cadastros/despesas src/app/(dashboard)/analise/despesas` e ajustar imports
- [ ] T037 [US2] Renomear o item de sidebar atual "Atendimentos" para "Agenda" em `dashboard-shell.tsx` (label + href apontando para a página de calendário, que já é o default de `/operacao/atendimentos`); confirmar que a Pendências (DLQ) já está com label correto
- [ ] T038 [US2] Estender `src/middleware.ts` adicionando, **antes** da regra de `/cadastros/medicos` existente, um array de pares `[from, to]` cobrindo `/cadastros/procedimentos→/configuracoes/procedimentos`, `/cadastros/planos→/configuracoes/convenios`, `/cadastros/profissionais→/configuracoes/profissionais`, `/cadastros/anamnese→/configuracoes/modelos-anamnese`, `/cadastros/despesas→/analise/despesas`; loop que faz `NextResponse.redirect(url, 301)` preservando `pathname.replace` para subpaths
- [ ] T039 [US2] Remover `src/app/(dashboard)/cadastros/page.tsx` (e o diretório `cadastros/` inteiro depois dos `git mv` acima); o redirect default `/cadastros` segue para `/configuracoes/clinica` (admin) ou `/configuracoes/perfil` (não-admin) — implementar essa branch role-aware no middleware reusando `await supabase.auth.getUser()` que já roda
- [ ] T040 [US2] Procurar com `grep` referências hardcoded a `/cadastros/` em todo `src/` (links, redirects internos, `next/navigation` calls) e substituir pelos novos paths; documentar no commit qualquer link externo conhecido (e-mails, integrações) que possa ainda apontar para `/cadastros/...` e contar com o 301

**Checkpoint**: US2 completa — sidebar reorganizada, sem abas, redirects 301 funcionando.

---

## Phase 5: User Story 3 — Perfil pessoal do usuário (Priority: P3)

**Goal**: qualquer usuário autenticado edita nome/foto/fuso e troca a própria senha; foto aparece na sidebar e nas listas de "criado por".

**Independent Test**: trocar foto + nome + senha; deslogar e logar novamente com a senha nova; ver foto e nome ao lado do email na sidebar (quickstart §4).

### Tests for User Story 3

- [ ] T041 [P] [US3] Contract test `tests/contract/api-configuracoes-perfil.test.ts` cobrindo GET/PUT do perfil (200, 401, 400 timezone inválido, 400 unsupported_field se body trouxer email), POST/DELETE avatar (200, 400 magic, 413), POST senha (204, 400 invalid_current_password, 400 weak_password) conforme `contracts/user-profile.md`
- [ ] T042 [P] [US3] Integration RLS test `tests/integration/user-profile-rls.test.ts` provando que (a) usuário lê o próprio perfil, (b) usuário lê o perfil de outro membro do mesmo tenant (para exibir avatar), (c) usuário NÃO lê perfil de membro de tenant diferente, (d) bucket `user-avatars` permite leitura cross-user dentro do mesmo tenant mas só o dono escreve

### Implementation for User Story 3

- [ ] T043 [P] [US3] Implementar `src/lib/core/user-profile/read.ts` exportando `getUserProfile(supabase, userId, tenantId)` que retorna a row de `user_profile` (cria via upsert se não existir) acrescida de `signedAvatarUrl`
- [ ] T044 [P] [US3] Implementar `src/lib/core/user-profile/update.ts` exportando `updateUserProfile(supabase, userId, patch)` validando Zod (`fullName`, `timezone` ∈ `Intl.supportedValuesOf('timeZone')`), gerando audit log por campo
- [ ] T045 [P] [US3] Implementar `src/lib/core/user-profile/upload-avatar.ts` (mesmo padrão de `upload-logo.ts`: validação de tamanho + magic bytes + upload para `{tenant_id}/{user_id}.{ext}` no bucket `user-avatars` + audit)
- [ ] T046 [P] [US3] Implementar `src/lib/core/user-profile/change-password.ts` exportando `changePassword(supabase, userId, email, currentPassword, newPassword)` que (a) cria client isolado `createClient(url, anon, { auth: { persistSession: false }})`, (b) chama `signInWithPassword` no client isolado para validar `currentPassword`, (c) valida `newPassword` (≥ 8 chars, ≥ 1 letra, ≥ 1 dígito), (d) chama `supabase.auth.updateUser({ password: newPassword })` no client da sessão, (e) audit `entity='user_profile', field='password'` (sem old/new)
- [ ] T047 [US3] Implementar Route Handler `src/app/api/configuracoes/perfil/route.ts` com `GET` e `PUT` (depende de T043, T044) — sem `requireRole` específico, basta sessão autenticada
- [ ] T048 [US3] Implementar Route Handler `src/app/api/configuracoes/perfil/avatar/route.ts` com `POST` e `DELETE` (depende de T045)
- [ ] T049 [US3] Implementar Route Handler `src/app/api/configuracoes/perfil/senha/route.ts` com `POST` (depende de T046)
- [ ] T050 [P] [US3] Criar Server Component `src/app/(dashboard)/configuracoes/perfil/page.tsx` que busca o perfil via `getUserProfile` no SSR e renderiza `<UserProfileForm>` + `<ChangePasswordForm>`
- [ ] T051 [P] [US3] Criar Client Component `src/app/(dashboard)/configuracoes/perfil/user-profile-form.tsx` com campos foto (upload + preview), nome completo, email (somente leitura), seletor de fuso (lista de `Intl.supportedValuesOf('timeZone')` com defaults brasileiros no topo)
- [ ] T052 [P] [US3] Criar Client Component `src/app/(dashboard)/configuracoes/perfil/change-password-form.tsx` com 3 campos (senha atual, nova, confirma) + validação client antes do POST
- [ ] T053 [US3] Modificar `src/app/(dashboard)/layout.tsx` para também buscar `userProfile` (avatar + fullName + timezone) e passar como prop para `<DashboardShell>`
- [ ] T054 [US3] Modificar o footer da sidebar em `dashboard-shell.tsx` (atualmente linhas 336–344) para renderizar `signedAvatarUrl` em `<img>` no lugar das iniciais quando disponível, e mostrar `fullName` quando preenchido (fallback para email)
- [ ] T055 [US3] Criar `src/lib/utils/format-with-timezone.ts` exportando `formatDateTimeInTz(date, tz)` e `formatDateInTz(date, tz)` que aceitam `Date | string` e o IANA tz; criar Context Provider `src/app/(dashboard)/_components/user-tz-context.tsx` que injeta `tz` para Client Components consumirem
- [ ] T056 [US3] Atualizar 2-3 listagens de maior tráfego que mostram autoria ("criado por" / "alterado por") — agenda (`src/app/(dashboard)/operacao/atendimentos/...`), pacientes — para renderizar `<AvatarBadge>` em vez das iniciais quando o autor tem `avatar_path`; criar `src/components/ui/avatar-badge.tsx` para reuso

**Checkpoint**: US3 completa — usuários gerenciam o próprio perfil, foto e fuso aparecem em toda a UI.

---

## Phase 6: User Story 4 — Gestão da equipe (Priority: P4)

**Goal**: admin lista, convida, muda função, desativa e reativa usuários do tenant; admin não consegue se desativar nem se rebaixar quando é a única admin ativa.

**Independent Test**: convidar email de teste, ver status "Convite pendente" → aceitar via inbucket → status "Ativo" → mudar função → desativar (validar que sessão é encerrada na próxima requisição) → reativar (sem novo email) (quickstart §5).

### Tests for User Story 4

- [ ] T057 [P] [US4] Contract test `tests/contract/api-configuracoes-usuarios.test.ts` cobrindo GET (200 lista, 403 não-admin), POST convite (201 sucesso, 409 user_already_active, 400 invalid_role/email, 502 invite_email_send_failed), PATCH role (200, 409 last_admin, 400 invalid_role), PATCH status (200, 409 cannot_disable_self, 409 last_admin), POST reenviar-convite (204, 409 not_pending) conforme `contracts/team-management.md`
- [ ] T058 [P] [US4] Integration test `tests/integration/team-invite-flow.test.ts` simulando o fluxo completo com Supabase local: criar tenant + admin → POST convite → checar `auth.users` criado + `user_tenants` row + email no inbucket → simular aceite (`auth.admin.updateUserById` setando senha) → confirmar status muda para "Ativo"
- [ ] T059 [P] [US4] Integration test `tests/integration/last-admin-trigger.test.ts` provando que (a) com 2 admins ativas, é possível rebaixar/desativar uma; (b) com 1 admin ativa, tentativa de UPDATE direto via service-role no DB ainda dispara o trigger e retorna `check_violation`; (c) a função `is_last_active_admin` retorna `true` para a última admin
- [ ] T060 [P] [US4] RBAC test `tests/integration/team-management-rbac.test.ts` simulando recepcionista, financeiro e profissional_saude tentando GET/POST/PATCH em `/api/configuracoes/usuarios/*` e esperando 403 em todos
- [ ] T061 [P] [US4] Integration test `tests/integration/disabled-user-killswitch.test.ts` provando que após desativar um usuário (status='disabled'), a próxima chamada autenticada do JWT dele a qualquer endpoint retorna 401/403 (RLS rejeita por `jwt_tenant_id() IS NULL`)

### Implementation for User Story 4

- [ ] T062 [P] [US4] Implementar `src/lib/core/team/list.ts` exportando `listTeamMembers(supabaseService, tenantId, requesterId)` que faz JOIN entre `user_tenants` (filtrando pelo tenant) e `auth.admin.listUsers` (paginado, capped em 100) + `user_profile` para cada userId, derivando o status conforme `data-model.md` §3 e marcando `isSelf` para a row do requester
- [ ] T063 [P] [US4] Implementar `src/lib/core/team/invite.ts` exportando `inviteTeamMember(supabaseService, tenantId, actorId, email, role)` que (a) valida unicidade ativa em `user_tenants`, (b) `auth.admin.createUser({ email, email_confirm: false })` tratando 422 como "reuse existente" e relendo o `id`, (c) insert em `user_tenants(user_id, tenant_id, role, status='active')`, (d) `auth.admin.inviteUserByEmail(email, { redirectTo })`, (e) audit `entity='user_tenants', field='invite'`
- [ ] T064 [P] [US4] Implementar `src/lib/core/team/set-role.ts` exportando `setTeamMemberRole(supabaseService, tenantId, actorId, targetUserId, newRole)` com pré-check `is_last_active_admin` (rejeita se ator==alvo e estaria saindo de admin único), UPDATE em `user_tenants`, audit `entity='user_tenants', field='role'`
- [ ] T065 [P] [US4] Implementar `src/lib/core/team/set-status.ts` exportando `setTeamMemberStatus(supabaseService, tenantId, actorId, targetUserId, status)` que (a) rejeita `cannot_disable_self` se ator==alvo e status='disabled', (b) UPDATE seteja `status`, `disabled_at`, `disabled_by`, deixando o trigger `enforce_last_admin` como segunda barreira, (c) audit `entity='user_tenants', field='status'`
- [ ] T066 [P] [US4] Implementar `src/lib/core/team/resend-invite.ts` exportando `resendInvite(supabaseService, tenantId, targetUserId)` que valida o estado pending (`status='active'` + `email_confirmed_at IS NULL`) e chama `auth.admin.inviteUserByEmail` novamente, audit como variação de invite
- [ ] T067 [US4] Implementar Route Handler `src/app/api/configuracoes/usuarios/route.ts` com `GET` chamando `listTeamMembers`, `requireRole('admin')` (depende de T062)
- [ ] T068 [US4] Implementar Route Handler `src/app/api/configuracoes/usuarios/convite/route.ts` com `POST` chamando `inviteTeamMember`, `requireRole('admin')` (depende de T063)
- [ ] T069 [US4] Implementar Route Handler `src/app/api/configuracoes/usuarios/[userId]/route.ts` com `PATCH` chamando `setTeamMemberRole`, `requireRole('admin')` (depende de T064)
- [ ] T070 [US4] Implementar Route Handler `src/app/api/configuracoes/usuarios/[userId]/status/route.ts` com `PATCH` chamando `setTeamMemberStatus`, `requireRole('admin')` (depende de T065)
- [ ] T071 [US4] Implementar Route Handler `src/app/api/configuracoes/usuarios/[userId]/reenviar-convite/route.ts` com `POST` chamando `resendInvite`, `requireRole('admin')` (depende de T066)
- [ ] T072 [P] [US4] Criar Server Component `src/app/(dashboard)/configuracoes/usuarios/page.tsx` que verifica `requireRole('admin')`, busca a lista via `listTeamMembers` no SSR e renderiza `<UsersList initial={users}>`
- [ ] T073 [P] [US4] Criar Client Component `src/app/(dashboard)/configuracoes/usuarios/users-list.tsx` com tabela (Nome / Email / Função / Status / Último acesso / Ações) e botões de ação por linha — abre dialogs filhos
- [ ] T074 [P] [US4] Criar Client Component `src/app/(dashboard)/configuracoes/usuarios/invite-user-dialog.tsx` (Radix Dialog do shadcn) com inputs email + select de role + submit POST `/api/configuracoes/usuarios/convite`
- [ ] T075 [P] [US4] Criar Client Component `src/app/(dashboard)/configuracoes/usuarios/change-role-dialog.tsx` com select de novo role + submit PATCH; mostra erro `last_admin` em toast quando o backend retorna 409
- [ ] T076 [P] [US4] Criar Client Component `src/app/(dashboard)/configuracoes/usuarios/disable-confirm-dialog.tsx` com confirmação textual + submit PATCH status; trata 409 `cannot_disable_self` e `last_admin`

**Checkpoint**: US4 completa — admin gerencia toda a equipe pelo painel.

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: validar que tudo funciona em conjunto e endurecer o que não cabe em uma única story.

- [ ] T077 [P] Implementar landing `src/app/(dashboard)/configuracoes/page.tsx` que detecta a role da sessão e faz `redirect()` para `/configuracoes/clinica` (admin) ou `/configuracoes/perfil` (demais) — usado pelo middleware quando a URL antiga `/cadastros` é acessada (T039 + T038)
- [ ] T078 [P] Atualizar `src/lib/auth/rbac.ts` adicionando ações novas se o lint:auth pedir (`team.read`, `team.write`, `clinic-profile.read`, `clinic-profile.write`, `user-profile.write`) — caso contrário, documentar no commit que `requireRole('admin')` direto é suficiente para esses endpoints e nenhuma extensão da matriz é necessária
- [ ] T079 [P] Atualizar `CLAUDE.md` (seção "Active Technologies") consolidando a entrada de feature 009 — já adicionada pelo `update-agent-context.ps1` em Phase 1 do plan; remover linhas duplicadas se houver
- [ ] T080 Executar `pnpm lint:auth` e corrigir qualquer endpoint novo sem `requireRole` ou adapter usando `process.env.*` direto (não deveria haver, mas confirmar)
- [ ] T081 Executar `pnpm typecheck` e resolver erros — esperado: zero
- [ ] T082 Executar `pnpm test` (suíte completa) e validar que os testes adicionados (T009–T012, T029–T030, T041–T042, T057–T061) passam, junto com a regressão das suítes existentes
- [ ] T083 Validar manualmente o `quickstart.md` ponta a ponta nas 5 stories (incluindo cross-cutting validations §6) e marcar a checklist conforme cada item passa
- [ ] T084 Inspecionar `audit_log` após o quickstart e confirmar que existem entradas para: update de clinic profile (1 por campo), upload de logo, convite, mudança de role, desativação, reativação, troca de senha — anexar SQL de evidência ao PR

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Setup)** → sem dependências.
- **Phase 2 (Foundational)** → depende de Phase 1. **BLOQUEIA** US1, US3, US4. (US2 não depende, mas roda após Phase 2 por simplicidade).
- **Phases 3–6 (User Stories)** → cada uma depende somente de Phase 2; são independentes entre si.
- **Phase 7 (Polish)** → depende das stories pretendidas para entrega.

### User Story Dependencies

- **US1 (P1)** — depende somente de Phase 2 (precisa de `tenant_clinic_profile` + bucket `clinic-logos`). Conflita com US2 e US3 no arquivo `dashboard-shell.tsx` (mesmo arquivo, mudanças aditivas — quem mergear segundo resolve trivialmente).
- **US2 (P2)** — depende somente de Phase 2 conceitualmente; tecnicamente independente do schema. Refatora `dashboard-shell.tsx` em larga escala (T031). Se US1 já mergeou, US2 preserva a integração com `clinicLogoUrl`. Se US3 já mergeou, US2 preserva o slot do avatar.
- **US3 (P3)** — depende de Phase 2 (precisa de `user_profile` + bucket `user-avatars`). Toca `dashboard-shell.tsx` para o avatar (T054).
- **US4 (P4)** — depende de Phase 2 (precisa de `user_tenants.status` + função/trigger + JWT hook atualizado em T003).

### Within Each User Story

- Tests primeiro (escreva e veja falhar) → modelos/services → endpoints → UI.
- Dentro de uma story, tarefas marcadas [P] tocam arquivos diferentes e podem rodar em paralelo.
- Tarefas sem [P] dependem das [P] anteriores (services antes de endpoints; endpoints antes de UI).

### Parallel Opportunities

- **Phase 2**: T006, T007, T008 (helpers em arquivos distintos) podem rodar juntos.
- **US1**: T009–T012 (tests), T013–T015 (services), T019–T021 (UI + PDF header) podem ser desenvolvidos em paralelo dentro de cada bloco.
- **US2**: T032–T036 (`git mv` em pastas distintas) são independentes.
- **US3**: T043–T046 (services), T050–T052 (pages/forms) em paralelo.
- **US4**: T057–T061 (5 testes em arquivos distintos), T062–T066 (services), T072–T076 (UI components) em paralelo.
- **Phase 7**: T077–T079 são independentes.

---

## Parallel Example: User Story 1

```bash
# Tests para US1 (escreva e veja falhar antes da implementação):
Task T009: tests/contract/api-configuracoes-clinica.test.ts
Task T010: tests/integration/clinic-profile-rls.test.ts
Task T011: tests/contract/api-configuracoes-cep.test.ts
Task T012: tests/unit/validate-cnpj.test.ts

# Services em paralelo:
Task T013: src/lib/core/clinic-profile/read.ts
Task T014: src/lib/core/clinic-profile/update.ts
Task T015: src/lib/core/clinic-profile/upload-logo.ts

# UI + PDF header em paralelo:
Task T019: src/app/(dashboard)/configuracoes/clinica/page.tsx
Task T020: src/app/(dashboard)/configuracoes/clinica/clinic-profile-form.tsx
Task T021: src/lib/pdf/clinic-header.tsx
```

---

## Implementation Strategy

### MVP First (User Story 1 only)

1. Phase 1 (T001) → Setup OK.
2. Phase 2 (T002–T008) → migration + helpers prontos.
3. Phase 3 (T009–T028) → admin tem perfil de clínica funcional, logo na sidebar e em todos os PDFs.
4. **STOP & VALIDATE**: rodar quickstart §2 — confirmar que o cabeçalho dos PDFs traz logo + razão social + CNPJ + responsável técnico.
5. Deploy/demo se desejado.

### Incremental Delivery

1. Setup + Foundational → Foundation pronta.
2. US1 → MVP entregável (clínica + PDFs).
3. US2 → reorganiza navegação; entregável independente.
4. US3 → perfil pessoal; entregável independente.
5. US4 → gestão de equipe; entregável independente.
6. Polish (Phase 7) → fechamento.

### Parallel Team Strategy

Após Phase 2 concluir, a equipe pode dividir:

- **Dev A**: US1 (foco em PDFs e branding).
- **Dev B**: US2 (refactor da sidebar). Sincroniza com Dev A para o slot da logo.
- **Dev C**: US3 (perfil pessoal).
- **Dev D**: US4 (gestão de equipe).

Conflitos previstos só em `dashboard-shell.tsx` (T028 vs T031 vs T054) — coordenar via merges sequenciais; cada mudança é aditiva.

---

## Notes

- Toda mutação em `tenant_clinic_profile`, `user_profile`, `user_tenants` (incluindo invite/role/status/password) **MUST** gerar linha em `audit_log` no mesmo handler. Constituição §II.
- Senhas **NÃO** entram em `audit_log` — apenas o evento temporal (`field='password'` sem `old/new`).
- Buckets são privados; URLs assinadas com TTL 24 h para sidebar, 5 min para PDFs.
- `requireRole('admin')` em **todos** os endpoints de US1 e US4. US3 aceita qualquer role autenticado.
- O trigger `enforce_last_admin` é defesa em profundidade — a validação primária roda no Route Handler para retorno 409 limpo; o trigger fecha race conditions.
- Migration 0064 é puramente aditiva e idempotente (`CREATE OR REPLACE`, `ON CONFLICT DO NOTHING`); reversível em dev via `pnpm supabase:reset`.
- 5 redirects 301 ficam em `src/middleware.ts`, mesmo padrão da rota `/cadastros/medicos` já em produção.
- Verificar tests falham antes de implementar (TDD). Comitar após cada task ou bloco lógico coerente.
