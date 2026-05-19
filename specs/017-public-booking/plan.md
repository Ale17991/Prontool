# Implementation Plan: Link público de agendamento online

**Branch**: `017-public-booking` | **Date**: 2026-05-19 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/017-public-booking/spec.md`

## Summary

Expor uma rota pública `/agendar/[slug]` (sem autenticação) onde pacientes podem criar consultas em clínicas com a feature habilitada. Resolve a queixa #1 de gap competitivo vs iClinic/Feegow/Doctoralia. Após esta feature, o Prontool fica vendável sem ressalvas funcionais para clínica pequena/média.

**Abordagem técnica** (derivada de `research.md`):

1. **Resolução por slug**: novo campo `tenant_clinic_profile.public_booking_slug` (separado de `tenants.slug` interno). RPC `public_booking_resolve_slug` SECURITY INVOKER + RLS policy específica para `anon`.
2. **Modelagem 1:N médico→procedimento** (clarification): tabelas `public_booking_doctors` + `public_booking_doctor_procedures`. Cada médico publicado tem sua lista de procedimentos com `display_name` + `duration_minutes` próprios.
3. **Disponibilidade declarada no escopo público** (decisão crítica do research): campos `available_weekdays` + `available_from` + `available_until` + `lunch_break_*` em `public_booking_doctors`. Evita criar tabela `doctor_availability` genérica.
4. **Slot calculator** via RPC `public_booking_slots` SECURITY DEFINER: clamp janela, subtrai `schedule_blocks` + `appointment_slot_locks`, discretiza por `duration_minutes`.
5. **Captcha**: Cloudflare Turnstile (sitekey/secret em env, sem nova dep npm — usa `fetch`).
6. **Rate limit** persistido em Postgres (`public_booking_rate_limits`, retenção 7 dias via cron). Sem Redis.
7. **Tokens de cancelamento**: 32-bytes random, armazenados como SHA-256 hash. Link público de 30 dias. Validação `timingSafeEqual`.
8. **Origem do appointment como público**: marcada via `audit_log` `event_type='public_booking_created'`, **não** via coluna nova em `appointments` (princípio I — não alterar tabela financeira sem necessidade).
9. **Notificação dual** (clarification): email Resend para admins + entrada em `notifications` (expandindo CHECK constraint `type` para incluir `'public_booking'`).
10. **Email com .ics**: novo pacote npm `ics` + extensão do `resend-client.ts` para suportar `attachments`.

## Technical Context

**Language/Version**: TypeScript 5.4 sobre Node.js 20 LTS (runtime Vercel).
**Primary Dependencies**: Next.js 14.2 (App Router + Server Actions + RSC), `@supabase/ssr` 0.5, `@supabase/supabase-js` 2.45, Zod 3.23 (validação payload público), Tailwind CSS 3.4, shadcn/ui (Radix), `date-fns` 4.1 + `date-fns-tz` (formatação timezone), Pino 9 (observabilidade). **Novas deps**: `ics` (~30kb gzipped, MIT). **Novas env vars**: `NEXT_PUBLIC_TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY`.
**Storage**: PostgreSQL via Supabase. **Migration nova**: `0084_public_booking.sql`. **Tabelas tocadas**: `tenant_clinic_profile` (acrescenta 5 colunas), `notifications` (expande CHECK constraint do `type`). **Tabelas novas**: `public_booking_doctors`, `public_booking_doctor_procedures`, `public_booking_tokens`, `public_booking_rate_limits`. **Funções DB novas**: `public_booking_resolve_slug` (INVOKER), `public_booking_slots` (DEFINER), `public_booking_find_patient_by_cpf` (DEFINER, helper privado).
**Testing**: Vitest existente. **Teste de contrato OBRIGATÓRIO** (constitucional III): provar que slug-A não consegue acessar dados de tenant-B. **Teste de RBAC** (constitucional V): rota pública não pode SELECT em entidades arbitrárias — só INSERT em paths dedicados. Sem novos testes E2E no escopo deste plano (definir em `/speckit-tasks` se serão Vitest+supertest ou Playwright).
**Target Platform**: Web — desktop e mobile (responsive). Mobile-first nas rotas públicas (paciente acessa pelo celular após ver post no Instagram).
**Project Type**: Web application — single Next.js project.
**Performance Goals**: latência do RPC `public_booking_slots` ≤200ms p95 (índices em `appointment_slot_locks (tenant_id, doctor_id, slot_range)` já existentes); email de confirmação enviado ≤5min (SC-008); fluxo paciente completável em ≤90s (SC-001).
**Constraints**: princípio II auditoria total (cada operação pública gera audit_log); princípio III isolamento (slug→tenant não pode vazar entre tenants); LGPD (IP só como hash, retenção 7d, consentimento explícito); EXCLUDE constraint existente em `appointment_slot_locks` é fonte da consistência anti-colisão; `pnpm typecheck` obrigatório após cada commit; cada user story em commit separado para `master`.
**Scale/Scope**: 1 migration nova; ~15 arquivos novos em `src/lib/core/public-booking/`, `src/app/agendar/[slug]/*`, `src/app/api/public/booking/*`, `src/app/(dashboard)/configuracoes/agendamento-publico/*`; ~5 telas paciente + 1 tela admin; estimativa total 14.5 dev-days (3 semanas) com 1 dev sênior.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Aplicabilidade | Status | Justificativa |
|---|---|---|---|
| **I. Integridade Financeira Imutável** | Aplicável indiretamente — appointments é tabela financeira | ✅ **Pass** | Apenas INSERT em `appointments` com `status='agendado'`. Sem UPDATE/DELETE em registros existentes. Origem "pública" marcada via `audit_log` (não nova coluna em appointments). Cancelamento via token usa fluxo existente que respeita imutabilidade (status muda para cancelado/estornado conforme política do projeto). |
| **II. Auditabilidade Total** | Aplicável diretamente | ✅ **Pass** | Cada operação pública (visualização, criação, cancelamento) gera `audit_log` com `actor_id=NULL`, `actor_label='public_booking'`, `event_type` discriminador, IP como **hash** (FR-018), user-agent. `log_audit_event` existente é reusado. |
| **III. Isolamento Multi-Tenant** | Aplicável diretamente — **CRÍTICO** | ✅ **Pass** | `slug → tenant_id` via RPC com filtro explícito por `public_booking_enabled = TRUE`. RPC `public_booking_slots` SECURITY DEFINER **valida** que `(doctor, procedure)` está em `public_booking_doctor_procedures` daquele tenant antes de retornar slots. Todas as INSERTs derivam `tenant_id` da resolução do slug — nunca aceitam `tenant_id` do client. **Teste de contrato obrigatório** (FR-033, SC-005) prova isolamento antes do merge. |
| **IV. Conformidade TUSS/ANS** | N/A | ✅ **Pass** | `procedure_id` referenciado em `public_booking_doctor_procedures` aponta para `procedures` existente, que já é TUSS-conforme. Sem novos códigos TUSS introduzidos. |
| **V. Segurança por Perfil (RBAC)** | Aplicável — **novo padrão** | ✅ **Pass com nota** | Rota pública é **novo padrão** ("guest" anônimo). RBAC server-side: rota pública só pode INSERT em paths dedicados (`appointments`, `patients` se novo, `audit_log`, `public_booking_tokens`, `public_booking_rate_limits`, `notifications`); MUST NOT SELECT em entidades existentes (FR-034). Tela admin `/configuracoes/agendamento-publico` restrita a `admin`+`recepcionista` via `requireRole` existente. **Teste de autorização** garante que rota pública sem JWT não pode ler dados privados. |

**Gates adicionais (Quality)**:

- **Persistência financeira append-only**: ✅ apenas INSERT em `appointments`; não há UPDATE em registros existentes além do fluxo padrão.
- **LGPD**: ✅ IP como hash (FR-018), retenção 7d (FR-019), consentimento explícito (FR-010), criptografia de PII de paciente reusada de patients existente, política de privacidade pública (FR-035).
- **Tokens/segredos**: ✅ `TURNSTILE_SECRET_KEY` em env não versionada. Tokens de cancelamento armazenados como hash, raw só no email.
- **Observabilidade**: ✅ cada operação pública emite evento estruturado (audit_log + pino logger).
- **Revisão**: PR toca código com dimensão constitucional (princípio III isolamento) → **revisão obrigatória por mantenedor com conhecimento de domínio** antes do merge. Justificativa: feature pública sem auth é vetor de ataque crítico.
- **Migration reversível em dev**: ✅ migration 0084 é additive (não drop de tabela existente); reversível.

**Resultado do gate**: ✅ **PASS** — nenhuma violação. Sem entradas em "Complexity Tracking".

**Item de atenção**: o **novo padrão "rota pública guest"** (princípio V) não viola — adiciona um caminho restrito. Mas merece destaque em revisão pois é a primeira vez no projeto.

## Project Structure

### Documentation (this feature)

```text
specs/017-public-booking/
├── spec.md                                 # Feature specification (entregue)
├── plan.md                                 # Este arquivo (/speckit-plan output)
├── research.md                             # Phase 0 — 19 decisões técnicas
├── data-model.md                           # Phase 1 — entidades + relacionamentos
├── quickstart.md                           # Phase 1 — como rodar local + testar
├── contracts/
│   ├── api-slots.contract.md               # GET slots
│   ├── api-create-booking.contract.md      # POST create
│   ├── api-cancel-booking.contract.md      # POST cancel
│   └── rpc-public-booking-slots.contract.md # Schema do RPC SQL
├── checklists/
│   └── requirements.md                     # Validação do spec (entregue)
└── tasks.md                                # Phase 2 — gerado por /speckit-tasks
```

### Source Code (repository root)

```text
supabase/migrations/
└── 0084_public_booking.sql                 # [NEW] migration única (5 tabelas + 3 RPCs + ALTERs)

src/lib/core/public-booking/                # [NEW] core domain
├── resolve-tenant.ts                       # slug → { tenantId, clinicName, policies }
├── list-slots.ts                           # chama RPC, mapeia para SlotDTO
├── create-booking.ts                       # orquestra paciente + appointment + token + email + notification
├── cancel-booking.ts                       # valida token, libera slot, audita
├── rate-limit.ts                           # check ip_hash + bump counter
├── turnstile-verify.ts                     # POST para siteverify, retorna { ok, errorCodes }
├── tokens.ts                               # gera token raw + sha256; valida no cancel
├── send-confirmation-email.ts              # Resend + .ics anexo (paciente)
├── send-admin-notification-email.ts        # Resend (admin)
├── create-bell-notification.ts             # INSERT em notifications
├── audit.ts                                # wrapper sobre log_audit_event existente
└── types.ts                                # SlotDTO, BookingPayload, etc.

src/lib/integrations/email/
├── resend-client.ts                        # [EDIT] adicionar sendBookingConfirmationEmail + sendAdminBookingNotificationEmail
└── booking-template.ts                     # [NEW] renderBookingHtml (paciente + admin)

src/lib/utils/
└── ics.ts                                  # [NEW] wrap do pacote `ics`; gera string

src/app/agendar/[slug]/                     # [NEW] rotas públicas (sem auth)
├── page.tsx                                # Landing: lista médicos publicados
├── horarios/page.tsx                       # Calendar picker
├── confirmar/page.tsx                      # Form de dados + LGPD + Turnstile
├── sucesso/[token]/page.tsx                # Confirmação com .ics + cancel link
├── cancelar/[token]/page.tsx               # Confirmação cancelamento (POST)
├── privacidade/page.tsx                    # Política LGPD padrão
└── error.tsx                               # Erro genérico (tenant disabled, slug 404)

src/app/api/public/booking/                 # [NEW] route handlers públicos
├── [slug]/slots/route.ts                   # GET com params
├── [slug]/create/route.ts                  # POST
└── cancel/[token]/route.ts                 # POST

src/app/(dashboard)/configuracoes/agendamento-publico/   # [NEW] admin UI
├── page.tsx                                # Server component: lê configuração atual
├── public-booking-form.tsx                 # Client: toggle + slug + médicos + procedimentos
└── actions.ts                              # Server actions: salvar config

src/components/public-booking/              # [NEW] componentes client da rota pública
├── doctor-list.tsx                         # Cards de médicos publicados
├── slot-picker.tsx                         # Calendar + horários disponíveis
├── patient-form.tsx                        # Form Zod + Turnstile widget
├── turnstile-widget.tsx                    # Wrap do Turnstile invisible
├── booking-summary.tsx                     # Resumo antes de confirmar
└── add-to-calendar-buttons.tsx             # Google/Apple Calendar links

tests/
├── contract/
│   ├── public-booking-tenant-isolation.test.ts   # [NEW] CRÍTICO — slug-A ≠ tenant-B
│   ├── public-booking-rls.test.ts                # [NEW] anon não pode SELECT outras tabelas
│   ├── public-booking-slot-collision.test.ts     # [NEW] 2 submits paralelos = 1 sucesso
│   └── public-booking-create-flow.test.ts        # [NEW] end-to-end criação
├── integration/
│   ├── public-booking-rate-limit.test.ts         # [NEW] 11ª request bloqueada
│   └── public-booking-cancel-token.test.ts       # [NEW] reuse, expired, hash mismatch
└── unit/
    ├── tokens.test.ts                            # [NEW] hash + verify
    ├── slot-calculator.test.ts                   # [NEW] discretização correta
    └── turnstile-verify.test.ts                  # [NEW] mock siteverify
```

**Estrutura escolhida**: **Single Next.js project** (existente). Toda a feature cabe nas pastas atuais sem reorganização. **Pasta inédita**: `src/app/agendar/` (fora do `(dashboard)` group route — não tem layout com sidebar/auth).

## Phases

### Phase 0 — Outline & Research ✅ COMPLETO

Output: [research.md](./research.md). Resolveu 19 itens, incluindo:
- ⚠ Decisão crítica: disponibilidade do médico declarada no escopo da feature pública (não em tabela genérica).
- Padrões de SECURITY DEFINER do projeto (3 exemplos auditados).
- Estratégia de criptografia de PII reaproveitada.
- Tokens hash + `timingSafeEqual`.
- Notification type enum expandido com `'public_booking'`.
- Rate limit em Postgres (sem Redis).
- Origem "pública" via `audit_log`, não nova coluna em `appointments`.
- Email com anexo `.ics` via extensão do Resend wrapper.

Zero `NEEDS CLARIFICATION` remanescente. Há 1 ponto a confirmar durante implementação (trigger conflitante em `appointment_slot_locks` — §13 do research).

### Phase 1 — Design & Contracts (este passo)

Outputs:
- `data-model.md` — 5 entidades novas + 1 ALTER + 1 CHECK expansion + 3 RPCs.
- `contracts/api-slots.contract.md` — GET `/api/public/booking/[slug]/slots`.
- `contracts/api-create-booking.contract.md` — POST `/api/public/booking/[slug]/create`.
- `contracts/api-cancel-booking.contract.md` — POST `/api/public/booking/cancel/[token]`.
- `contracts/rpc-public-booking-slots.contract.md` — schema SQL.
- `quickstart.md` — env vars, sitekey de teste do Turnstile, como rodar testes de contrato.
- Update de `CLAUDE.md` via script.

### Phase 2 — Tasks (gerado por `/speckit-tasks`)

Não escrito por este comando. Esperado: decomposição das 5 user stories em tarefas atômicas, ordenadas por:
1. Migration + RPCs (foundational)
2. US2 (config admin) — primeiro porque sem ela US1 não pode ser testado
3. US1 (fluxo paciente) — usa US2 para validar
4. US3 (segurança) — captcha + rate limit + isolation tests
5. US5 (confirmação rica) — .ics + email
6. US4 (cancelamento via token)
7. Polish + quickstart validation

Commit + push por user story.

## Complexity Tracking

> **Sem violações de constituição**. Tabela vazia.

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| — | — | — |

**Nota sobre o "novo padrão de papel guest"**: não é violação — é extensão consistente do princípio V (RBAC server-side, defesa em camadas). Documentado em research §11.

---

## Re-evaluation Post-Phase-1

Após geração de `data-model.md`, `contracts/api-slots.contract.md`, `contracts/api-create-booking.contract.md`, `contracts/api-cancel-booking.contract.md`, `contracts/rpc-public-booking-slots.contract.md` e `quickstart.md`:

- **Constituição re-avaliada após design**: nenhuma nova superfície de domínio sensível introduzida. Princípios I–V continuam ✅ Pass com a justificativa original.
- **Princípio III (multi-tenant) re-validado**: o design dos contracts deriva `tenant_id` exclusivamente do slug, nunca do client. Reforço: `public_booking_slots` valida `(tenant, doctor, procedure)` antes de retornar dados. **Teste de isolamento** documentado em `rpc-public-booking-slots.contract.md` §Testabilidade — gate obrigatório para merge.
- **Princípio II (auditabilidade) re-validado**: cada caminho server-side em ambos os contracts (create + cancel) lista `INSERT audit_log` como passo explícito, com `actor_label='public_booking'`, hash de IP, user-agent.
- **Princípio V (RBAC) re-validado**: rotas públicas só INSERT em tabelas dedicadas. `find_patient_by_cpf` é `service_role` only — explicitamente bloqueando acesso direto via `anon`.
- **Anti-preview de email** documentado em api-cancel-booking.contract.md (§Anti-preview): GET é read-only renderiza confirmação, POST executa. Decisão arquitetural não-óbvia capturada antes da implementação.
- **Sem violações novas** descobertas durante design.
- **Sem entradas em Complexity Tracking** — tabela permanece vazia.
- **Ponto a confirmar durante implementação** (não bloqueia plano): trigger em `appointment_slot_locks` ON UPDATE/DELETE de `appointments` — investigação capturada em research §13 e referenciada em data-model §10 e api-cancel-booking.contract.md §passo 10.

✅ **Plan final aprovado.** Pronto para `/speckit-tasks`.

(Preenchido após data-model.md, contracts/ e quickstart.md gerados.)
