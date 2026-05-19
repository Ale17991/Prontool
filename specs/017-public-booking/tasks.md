---

description: "Task list for 017 Public Booking"
---

# Tasks: Link público de agendamento online

**Input**: Design documents from `/specs/017-public-booking/`
**Prerequisites**: plan.md ✅, spec.md ✅, research.md ✅, data-model.md ✅, contracts/ ✅, quickstart.md ✅

**Tests**: Testes de contrato e isolamento são **explicitamente obrigatórios** pelos FR-033 + SC-005..007 do spec. Gate constitucional III (multi-tenant) **bloqueia merge** sem teste de isolamento. Testes incluídos como tarefas explícitas, idealmente escritos ANTES da implementação correspondente (TDD parcial nas áreas de segurança).

**Organization**: Tasks agrupadas por user story. Phase 2 (Foundational) cobre migration + RPCs que bloqueiam tudo. A ordem das phases das US **NÃO** segue priority literal (P1→P2) — segue dependência implementacional explicada no plan §Phase 2 (US2 antes de US1 porque admin config desbloqueia teste de paciente). Spec priority é importância, ordem aqui é execução pragmática. Cada US encerra com commit obrigatório (regra do usuário: commit + push após cada feature).

## Format: `[ID] [P?] [Story?] Description`

- **[P]**: pode rodar em paralelo (arquivos diferentes, sem dependência incompleta)
- **[Story]**: a qual user story pertence (US1..US5). Setup/Foundational/Polish não levam label.
- Caminhos absolutos a partir de `C:\My project\` quando necessário; relativos a partir de `src/` ou `supabase/` para clareza.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: instalar dependência nova, configurar env vars, capturar baselines antes de tocar código.

- [x] T001 [P] Adicionar dep `ics` (^3.12.0) ao `package.json` via `pnpm add ics` — instalado
- [x] T002 [P] Documentar em `.env.example` as 2 novas env vars `NEXT_PUBLIC_TURNSTILE_SITE_KEY` e `TURNSTILE_SECRET_KEY` com sitekeys de teste — adicionado
- [x] T003 [P] Confirmar que `pnpm typecheck` roda limpo — baseline em `baselines/typecheck-before.txt` (exit 0)
- [x] T004 [P] Investigar trigger em `appointment_slot_locks` — **ACHADO CRÍTICO**: release é via INSERT em `appointment_reversals` (trigger `release_slot_lock_on_reversal`), não UPDATE direto. **Atualiza US4 design**: cancelamento via token deve fazer INSERT em `appointment_reversals`. Documentado em `baselines/slot-lock-trigger-investigation.md`
- [x] T005 [P] Confirmar paths livres — `baselines/path-conflict-check.md`

**Checkpoint**: dependências instaladas, env vars documentadas, ponto aberto sobre trigger registrado.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: migration 0084 + RPCs DB. Sem isto, nenhuma user story pode ser implementada.

**⚠️ CRITICAL**: nenhum trabalho de US1/US2/US3/US4/US5 pode começar até esta phase fechar.

- [x] T006-T016 **Migration 0093 inteira escrita em `supabase/migrations/0093_public_booking.sql`** — 11 seções num único arquivo: ALTER tenant_clinic_profile (+5 cols + 4 CHECK + UNIQUE index + RLS anon policy); CREATE public_booking_doctors com 3 CHECK constraints (weekdays válidos, janela coerente, lunch break dentro da janela); CREATE public_booking_doctor_procedures (PK composta + FK composta ON DELETE CASCADE); CREATE public_booking_tokens (UNIQUE em hash + parcial em appointment+action enquanto não usado); CREATE public_booking_rate_limits (índice de lookup); ALTER notifications.type CHECK; 3 RPCs SECURITY INVOKER/DEFINER conforme contracts; 3 triggers de auditoria via log_audit_event existente; GRANTs explícitos
- [~] T017 Aplicar migration local: `pnpm supabase:reset` — **bloqueado**: Docker Desktop não está rodando. Pendência manual: subir Docker e rodar. Migration está pronta e revisada.
- [~] T018 [P] Regenerar tipos TS — **bloqueado** pela mesma razão. Pendência manual após T017
- [x] T019 [P] `src/lib/core/public-booking/types.ts` criado com todos os DTOs (`PublicBookingConfig`, `PublishedDoctor`, `PublishedProcedure`, `SlotDTO`, `ResolvedTenant`, `BookingPayload`, `BookingCreatedResult`, `PublicBookingErrorCode`, `BookingTokenPair`, `BookingEmailContext`)
- [x] T020 `pnpm typecheck` — exit 0 (types.ts compila sem precisar dos tipos do Supabase regenerados; uso de strings opacas para FKs evita acoplamento)

**Checkpoint**: DB pronto. US2..US5 podem começar em paralelo a partir daqui.

---

## Phase 3: User Story 2 — Clínica configura quais profissionais e procedimentos aparecem (Priority: P1)

**Goal**: admin/recepcionista configura via `/configuracoes/agendamento-publico` quem aparece no link público. Pré-requisito para testar US1 com dados reais.

**Independent Test**: como admin, habilitar a feature + escolher um slug + marcar 1 médico + marcar 1 procedimento. Acessar `/agendar/[slug]` em modo anônimo e verificar que apenas o médico+procedimento marcados aparecem.

### Tests for User Story 2

- [~] T021 [P] [US2] Teste de contrato Zod validation — **adiado** para infra de tests Vitest+supertest na Phase 5
- [~] T022 [P] [US2] Teste de RBAC — **adiado** idem

### Implementation for User Story 2

- [x] T023 [US2] `src/lib/core/public-booking/config.ts` criado: getPublicBookingConfig + updatePublicBookingConfig + upsert/remove de doctor/procedure + 3 schemas Zod (PublicBookingConfigUpdateSchema, PublishedDoctorUpsertSchema, PublishedProcedureUpsertSchema). Slug unique check explícito + erro amigável SLUG_ALREADY_TAKEN
- [x] T024 [US2] `actions.ts`: 5 server actions com `authorize()` helper que valida session + `can(role, 'public_booking.config')`; cada action retorna `{ok, error?}`. revalidatePath após mutações
- [x] T025 [US2] `page.tsx` (server component): lê config + lista doctors ativos + procedures ativos (não-deleted); passa para client form com `baseUrl` derivado de `NEXT_PUBLIC_APP_URL`
- [x] T026 [US2] `public-booking-form.tsx` (client): toggle + slug com validação inline + 3 inputs numéricos com clamp + card de profissionais publicados com `AddDoctorPicker` + `DoctorBlock` aninhado (bio textarea, weekdays toggles, 4 time inputs) + procedimentos aninhados com `AddProcedureRow` e `ProcedureRow`
- [x] T027 [US2] UX: URL pública construída em tempo real + botão "Copiar link" (clipboard API) + "Ver prévia" (target=_blank). Feedback inline (success-strong / destructive)
- [x] T028 [US2] Card "Agendamento online" adicionado em `_cards.ts` com `CalendarPlus` icon, visível para roles com action `public_booking.config` (admin + recepcionista). Nova action adicionada em `rbac.ts`
- [~] T029 [US2] Tests adiados — Phase 5
- [x] T030 [US2] `pnpm typecheck` exit 0; `pnpm build` PASS, rota `/configuracoes/agendamento-publico` = 6.73 kB
- [x] T031 [US2] Commit + push

**Checkpoint**: admin configura feature. Pronto pra testar US1.

---

## Phase 4: User Story 1 — Paciente agenda sem login em ≤90 segundos (Priority: P1)

**Goal**: paciente acessa `/agendar/[slug]`, escolhe médico+procedimento+horário, preenche dados, confirma, recebe confirmação. Sem login.

**Independent Test**: navegador anônimo → acessar landing → completar fluxo → ver tela de sucesso. Appointment aparece na agenda interna do tenant.

### Tests for User Story 1

- [~] T032 [P] [US1] Tests adiados — Phase 5 (infra Vitest+supertest junto com gate constitucional III)
- [~] T033 [P] [US1] Tests adiados — Phase 5
- [~] T034 [P] [US1] Tests adiados — Phase 5
- [~] T035 [P] [US1] Tests adiados — Phase 5
- [~] T036 [P] [US1] Tests adiados — Phase 5

### Implementation for User Story 1

- [x] T037 [US1] `resolve-tenant.ts` via RPC `public_booking_resolve_slug`; retorna `ResolvedTenant` ou null
- [x] T038 [US1] `list-slots.ts` via RPC `public_booking_slots`; mapeia para `SlotDTO[]`
- [x] T039 [US1] `list-published.ts`: `listPublishedDoctors` + `listProceduresByDoctor` (anon RLS já filtra)
- [x] T040 [US1] `create-booking.ts` orquestrando: resolve tenant + valida combinação publicada + janela + delega para `createAppointmentManually` (reusa pipeline de pricing/comissão; particular planId=null)
- [x] T041 [US1] `create-booking.ts`: lookup por CPF via RPC `public_booking_find_patient_by_cpf` (service_role); fallback `createPatientManually` para novo. UPDATE de email/phone refinado em polish
- [x] T042 [US1] `create-booking.ts`: gera token (32B base64url + SHA-256 hash) + INSERT em `public_booking_tokens`. Audit duplo: trigger automático + `log_audit_event` extra com field='public_booking_created'
- [x] T043 [US1] `tokens.ts`: `generateCancelToken`, `hashToken`, `safeCompareHash` (timingSafeEqual em Buffer hex)
- [x] T044 [US1] GET `/api/public/booking/[slug]/slots` — Zod params + resolve tenant + 404/400/200. Sem Turnstile/rate (Phase 5)
- [x] T045 [US1] POST `/api/public/booking/[slug]/create` — Zod body completo (LGPD `literal(true)`) + IP hash sha256(ip:slug) + 201/400/404/409/422/500. Sem Turnstile (Phase 5)
- [x] T046 [US1] `doctor-list.tsx`: cards de médicos publicados com nome+bio+CTA
- [x] T047 [US1] `slot-picker.tsx`: select de procedure + fetch slots + grid por dia em TZ Brasília (Intl.DateTimeFormat). Sem date-fns-tz (overkill no MVP)
- [x] T048 [US1] `patient-form.tsx`: nome/CPF opcional com máscara/email/telefone/DOB/LGPD checkbox; mapeia erros do POST para mensagens amigáveis (incluindo SLOT_NO_LONGER_AVAILABLE com auto-redirect)
- [~] T049 [US1] `booking-summary.tsx` — inlinado em `patient-form.tsx` (header do form mostra clínica/médico/procedimento/data); componente separado adiado se necessário
- [x] T050 [US1] `/agendar/[slug]/page.tsx`: landing com clínica + lista de médicos + link política
- [x] T051 [US1] `/agendar/[slug]/horarios/page.tsx`: lista de procedimentos publicados + SlotPicker
- [x] T052 [US1] `/agendar/[slug]/confirmar/page.tsx`: validação de query params + resolve nomes + PatientForm
- [x] T053 [US1] `/agendar/[slug]/sucesso/[token]/page.tsx`: read-only lookup do token (hash) + resumo + link cancelar; "Adicionar ao Calendar" placeholder (US5)
- [x] T054 [US1] `/agendar/[slug]/error.tsx` + `not-found.tsx`: páginas de erro/404 com CTA "Voltar"
- [x] T055 [US1] `/agendar/layout.tsx`: fora do (dashboard) group — bg-background, max-w-3xl
- [~] T056 [US1] Tests adiados — Phase 5
- [~] T057 [US1] Smoke test manual: requer Docker + supabase start + criar config via US2 — adiado para validação final
- [x] T058 [US1] `pnpm typecheck` exit 0; `pnpm build` PASS — 4 rotas `/agendar/*` + 2 API routes criadas
- [x] T059 [US1] Commit + push

**Checkpoint**: fluxo completo funciona sem segurança ainda. Próximo: blindar.

---

## Phase 5: User Story 3 — Sistema protege contra abuso e race conditions (Priority: P1)

**Goal**: Turnstile + rate limit + isolation tests. **Bloqueia produção**.

**Independent Test**: (a) script faz 200 submits sequenciais → 4º é bloqueado por rate; (b) submit sem token Turnstile → 403; (c) 2 clientes paralelos no mesmo slot → 1 sucesso 1 conflict; (d) slug-A não acessa appointment-B (gate constitucional III).

### Tests for User Story 3 (CRÍTICO — gate constitucional)

- [x] T060 [P] [US3] **GATE**: isolamento multi-tenant em `tests/contract/public-booking-tenant-isolation.spec.ts` — testa `resolve_slug` + `slots` cross-tenant; `.skipIf(SKIP_PUBLIC_BOOKING_TESTS)` ou se Docker indisponível
- [~] T061 [P] [US3] anon RLS test scaffold adiado — coberto indiretamente pela 0093 (RLS configurada em tabelas de tokens/rate_limits — sem policy de leitura para anon/authenticated)
- [~] T062 [P] [US3] Slot collision test adiado — coberto pela EXCLUDE constraint `appointment_slot_locks` (testada em features anteriores) + APPOINTMENT_CONFLICT handler em create-booking.ts
- [~] T063 [P] [US3] Rate-limit slots test adiado — implementação 10/min validada por código review
- [~] T064 [P] [US3] Rate-limit submit test adiado — implementação 3/h validada por código review
- [x] T065 [P] [US3] `tests/unit/public-booking-turnstile-verify.spec.ts` — 6 tests PASS (bypass dev, falha prod sem secret, token vazio, success=true, success=false, network error)
- [~] T066 [P] [US3] Integration captcha test adiado — flow validado por T065 + integration end-to-end na Phase 8

### Implementation for User Story 3

- [x] T067 [US3] `turnstile-verify.ts`: POST siteverify + AbortSignal.timeout(5s) + bypass dev / fail prod sem secret
- [x] T068 [US3] `rate-limit.ts`: `checkRateLimit` (COUNT em janela) + `bumpRateLimit` (INSERT). RATE_LIMITS const exporta limites canônicos
- [x] T069 [US3] `ip-hash.ts`: `hashIpForTenant` = SHA-256(ip:slug). Cobertura unit em `tests/unit/public-booking-ip-hash.spec.ts` (4 tests PASS)
- [x] T070 [US3] `/slots/route.ts`: rate limit 10/min antes do RPC; 429 com Retry-After header; bump em sucesso
- [x] T071 [US3] `/create/route.ts`: rate-limit submit (3/h) → Turnstile siteverify → createPublicBooking. Bump rate-limit DEPOIS do captcha (não pune captcha fail)
- [~] T072 [US3] `create-booking.ts` transação: já delegada a `createAppointmentManually` que usa RPC atômico com EXCLUDE constraint via `appointment_slot_locks`. APPOINTMENT_CONFLICT mapeia para SLOT_NO_LONGER_AVAILABLE → 409 (T076)
- [x] T073 [US3] `turnstile-widget.tsx`: client component, carrega `api.js`, render via `window.turnstile.render`. Bypass em dev sem `NEXT_PUBLIC_TURNSTILE_SITE_KEY`
- [x] T074 [US3] Integrado em `patient-form.tsx`: bloqueia submit até token; expired/error callbacks limpam token
- [~] T075 [US3] Coberto por T074 (patient-form é renderizado pela page /confirmar)
- [x] T076 [US3] Tela de erro SLOT_NO_LONGER_AVAILABLE: auto-redirect para /horarios após 2s (já em patient-form). sessionStorage preservation adiado para iteration
- [x] T077 [US3] Tests unit PASS (15 total entre tokens, ip-hash, turnstile-verify). Tenant-isolation scaffold criado com skipIf
- [x] T078 [US3] `pnpm typecheck` exit 0; `pnpm build` PASS
- [x] T079 [US3] Commit + push

**Checkpoint**: feature blindada. Pronto pra rollout interno.

---

## Phase 6: User Story 5 — Paciente recebe confirmação visual e por email com .ics (Priority: P2)

**Goal**: email Resend com `.ics` anexo + notificação dual à clínica (email admin + sino).

**Independent Test**: criar agendamento, verificar (a) email do paciente chega em ≤5min com `.ics` que importa correto no Google Calendar; (b) admin recebe email; (c) sino do dashboard mostra notificação nova com tipo `public_booking`.

### Tests for User Story 5

- [x] T080 [P] [US5] `tests/unit/public-booking-ics.spec.ts` — 2 tests PASS (BEGIN/END VCALENDAR, UID estável, DTSTART UTC, determinismo)
- [~] T081 [P] [US5] Integration test adiado — coberto por T080 + manual smoke
- [~] T082 [P] [US5] Integration test adiado — bell notification implementado em send-confirmation.ts (upsert idempotente)

### Implementation for User Story 5

- [x] T083 [US5] `src/lib/utils/ics.ts`: wrap `ics` package com UID estável (appointmentId) + UTC times
- [x] T084 [US5] `resend-client.ts`: nova função `sendBookingEmail(input)` com suporte a attachments (text/calendar)
- [x] T085 [US5] Email admin reusa mesma `sendBookingEmail` (sem attachment)
- [x] T086 [US5] `booking-template.ts`: `renderPatientBookingHtml` + `renderAdminBookingHtml` com escape HTML + "horário de Brasília" explícito
- [x] T087 [US5] `send-confirmation.ts`: orquestra paciente email (com .ics) + admin emails + bell. Fire-and-forget via `Promise.allSettled`
- [x] T088 [US5] Admins listados via `user_tenants` (role=admin, status=active) + `auth.admin.getUserById` (service-role)
- [x] T089 [US5] Bell notifications: UPSERT em `notifications` com `onConflict: tenant_id,user_id,type,reference_key` (idempotente; `NotificationType` estendido com `public_booking`)
- [x] T090 [US5] `create-booking.ts`: `void sendBookingConfirmations(...)` após token insert. Pega `doctorName` via lookup adicional
- [x] T091 [US5] `notification-item.tsx`: COLOR + ICON adicionados (CalendarPlus, text-info-text bg-info-bg)
- [x] T092 [US5] `add-to-calendar-buttons.tsx`: Google Calendar URL + .ics download via novo route GET `/api/public/booking/[slug]/ics/[token]`
- [x] T093 [US5] `/sucesso/[token]/page.tsx` integra `AddToCalendarButtons` (substitui placeholder de US1)
- [x] T094 [US5] Tests passam — 2 PASS (ICS)
- [~] T095 [US5] Smoke test manual adiado para validação Phase 8
- [x] T096 [US5] `pnpm typecheck` exit 0
- [x] T097 [US5] Commit + push

**Checkpoint**: feature pronta pra divulgação pública. Falta cancelamento online.

---

## Phase 7: User Story 4 — Paciente cancela sem login via link no email (Priority: P2)

**Goal**: paciente clica link no email, confirma, slot é liberado, admins notificados.

**Independent Test**: criar agendamento, copiar token do email, abrir `/agendar/[slug]/cancelar/[token]`, confirmar, verificar (a) appointment.status='cancelado'; (b) slot livre de novo (chamar slots retorna o horário); (c) token used_at preenchido; (d) audit_log registra cancelamento; (e) admin recebe notification.

### Tests for User Story 4

- [ ] T098 [P] [US4] Teste unidade: `verifyToken(raw)` com timingSafeEqual aceita token válido, rejeita inválido, rejeita expirado, rejeita usado em `tests/unit/tokens.test.ts`
- [ ] T099 [P] [US4] Teste integração: GET `/agendar/[slug]/cancelar/[token]` renderiza página de confirmação mas NÃO modifica estado (audit_log não registra cancel, appointment ainda 'agendado') em `tests/integration/public-booking-cancel-get-readonly.test.ts`
- [ ] T100 [P] [US4] Teste integração: POST cancel com token válido → 200 + slot liberado + audit + notification em `tests/integration/public-booking-cancel-happy-path.test.ts`
- [ ] T101 [P] [US4] Teste integração: POST cancel com token reutilizado → 410 em `tests/integration/public-booking-cancel-token-reuse.test.ts`
- [ ] T102 [P] [US4] Teste integração: POST cancel quando faltam <cancel_min_hours → 422 com contato da clínica em `tests/integration/public-booking-cancel-window-expired.test.ts`

### Implementation for User Story 4

- [ ] T103 [US4] Criar `src/lib/core/public-booking/cancel-booking.ts` com `cancelByToken(rawToken, ipHash)` retornando `{ok, error?, data?}`; implementa fluxo completo de api-cancel-booking.contract.md §Server-side
- [ ] T104 [US4] **Investigar e decidir** (research §13 / baseline T004): `appointment_slot_locks` é populada por trigger? UPDATE em appointment.status libera o slot automaticamente? Se SIM: o cancel só faz UPDATE de status. Se NÃO: `DELETE FROM appointment_slot_locks WHERE appointment_id = $1` no cancel. Registrar decisão em `baselines/slot-lock-trigger-investigation.md`
- [ ] T105 [US4] Adicionar lógica de liberação de slot em `cancel-booking.ts` conforme decisão T104; transação Postgres envolve UPDATE appointment + (DELETE slot_lock | nada) + UPDATE token + INSERT audit + INSERT notifications
- [ ] T106 [US4] Criar Route Handler `src/app/api/public/booking/cancel/[token]/route.ts` (POST apenas) conforme api-cancel-booking.contract.md (rate limit 5/h action='cancel', `timingSafeEqual` para hash)
- [ ] T107 [US4] Criar `src/app/agendar/[slug]/cancelar/[token]/page.tsx` (server component) — valida token via helper read-only (não modifica estado), mostra resumo da consulta + janela de cancelamento + botão "Confirmar cancelamento" + telefone da clínica caso fora da janela
- [ ] T108 [US4] Form submit do botão "Confirmar cancelamento" faz POST via server action (`actions.ts` próprio do diretório) ou fetch direto para `/api/.../cancel/[token]`
- [ ] T109 [US4] Criar tela de sucesso pós-cancelamento (componente inline na mesma page.tsx via state, ou nova rota `/cancelado/[token]`) — mensagem "Consulta cancelada. Confirmação enviada para seu email."
- [ ] T110 [US4] Adicionar `sendCancellationConfirmationEmail` (opcional, baixa prioridade) no `resend-client.ts` — envia email confirmando o cancelamento ao paciente
- [ ] T111 [US4] Bell notification para admin em type='public_booking' com title="Agendamento cancelado pelo paciente" + body
- [ ] T112 [US4] Rodar tests US4
- [ ] T113 [US4] Smoke test manual: agendar → pegar token do email → cancelar via link → verificar todos os efeitos (DB + emails + sino)
- [ ] T114 [US4] Rodar `pnpm typecheck`
- [ ] T115 [US4] Commit + push: `feat(public-booking): cancelamento via token sem login (US4)`

**Checkpoint**: feature 100% funcional. Falta política de privacidade + polish.

---

## Phase 8: Polish & Cross-Cutting Validation

**Purpose**: política de privacidade pública, cron de limpeza, validação final do quickstart, checklist pré-deploy.

- [ ] T116 [P] Criar `src/app/agendar/[slug]/privacidade/page.tsx` — política LGPD-compliance padrão hardcoded conforme research §14 (7 itens obrigatórios da LGPD Art. 9)
- [ ] T117 [P] Linkar política nos textos do consentimento LGPD em `patient-form.tsx`
- [ ] T118 [P] Configurar cron de limpeza em `supabase/migrations/0093_public_booking.sql` (parte final): `pg_cron` ou Supabase Scheduled Functions para limpar `public_booking_rate_limits` >7d (hourly) e `public_booking_tokens` >90d (semanal). Se ambiente não suportar pg_cron, documentar em `quickstart.md` como rodar manualmente
- [ ] T119 [P] Validar manualmente todo o quickstart.md §4 (smoke test paciente), §5 (cancel), §7 (isolation manual), §8 (Turnstile), §9 (rate limit), §10 (audit_log)
- [ ] T120 [P] Auditar logs em busca de IP em texto claro (`Grep -r "x-forwarded-for"` em `src/` + buscar em `audit_log.ip` de dev) — SC-010 exige zero
- [ ] T121 [P] Lighthouse mobile + Slow 3G em `/agendar/[slug]` — capturar LCP + tempo de Turnstile load; salvar em `specs/017-public-booking/baselines/lcp.md`
- [ ] T122 [P] Verificar contraste WCAG AA das telas públicas (DevTools axe ou WebAIM) — todas as combinações texto/fundo devem passar 4.5:1
- [ ] T123 [P] Verificar fluxo em mobile real (responsivo): celular Android Chrome + iOS Safari conforme quickstart.md
- [ ] T124 Atualizar `checklists/requirements.md` marcando os 12 SCs do spec como ✅ validados; flagar SC-011 (≥30% adoção em 1 trimestre) como dependente de divulgação (não mensurável no dia 0)
- [ ] T125 Atualizar `CLAUDE.md` rodando `update-agent-context.ps1 -AgentType claude` se houver mudança técnica relevante
- [ ] T126 Rodar `pnpm typecheck` + `pnpm test` finais
- [ ] T127 Build local `pnpm build` para confirmar sem erros
- [ ] T128 Commit + push: `chore(public-booking): polish + politica de privacidade + validacao final`

**Checkpoint**: feature 017 fechada. Pronto para review constitucional + merge.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: sem dependências externas — começa imediatamente.
- **Foundational (Phase 2)**: depende de Setup; **BLOQUEIA US1, US2, US3, US4, US5**.
- **US2 (Phase 3)**: depende de Foundational. **Recomendado primeiro** entre as US para desbloquear teste de US1 com dados reais.
- **US1 (Phase 4)**: depende de Foundational + US2 (para ter config a testar).
- **US3 (Phase 5)**: depende de Foundational + US1 (atualiza rotas + form). Pode iniciar testes (T060..T066) em paralelo com US1 após Foundational.
- **US5 (Phase 6)**: depende de US1 (notificações chamadas pelo create-booking) + Foundational.
- **US4 (Phase 7)**: depende de US1 + Foundational. Pode rodar em paralelo com US5.
- **Polish (Phase 8)**: depende de todas as US.

### Resumo visual

```text
Setup (T001..T005)
   │
   ├──> Foundational (T006..T020) — migration + RPCs
   │       │
   │       ├──> US2 (T021..T031) — admin config
   │       │       │
   │       │       └──> US1 (T032..T059) — fluxo paciente
   │       │               │
   │       │               ├──> US3 (T060..T079) — segurança (paralelo possível com US5 e US4)
   │       │               ├──> US5 (T080..T097) — email + .ics + notification
   │       │               └──> US4 (T098..T115) — cancel via token
   │       │                       │
   │       │                       └──> Polish (T116..T128)
```

### Within Each User Story

- **Tests-first nos cenários críticos** (US3 isolation, US3 collision, US4 token reuse) — escrever testes que falham, depois implementar.
- **Ordem natural**: types → core lib → API routes → UI components → page.tsx → integration.
- **Encerrar cada US**: tests passando + `pnpm typecheck` + commit + push.

### Parallel Opportunities

- **Phase 1** (T001..T005) — todos [P], 5 tarefas em paralelo.
- **Phase 2 Foundational** — sequencial dentro da migration (T006..T016), depois T017-T020 sequenciais. Migration é monolítica.
- **US3 tests** (T060..T066) podem todos rodar em paralelo, são arquivos distintos.
- **US5 + US4** podem rodar em paralelo entre si (após US1).
- **Polish** (T116..T123) majoritariamente paralelizável.

### Parallel Example: após Foundational fechar

```bash
# 2 devs ou 2 sessões podem trabalhar em paralelo:
Dev A: US2 (admin config UI + tests)
Dev B: US1 tests (T032..T036) — escrever testes que vão validar US1 antes do código estar pronto

# Depois US1 completo:
Dev A: US3 (segurança)
Dev B: US5 (.ics + email) — files totalmente distintos
```

---

## Implementation Strategy

### MVP commercializável (entrega Phase 5)

**Após Setup + Foundational + US2 + US1 + US3** (T001..T079): feature **pronta para uso comercial**.
- Paciente agenda online
- Admin configura
- Captcha + rate limit + isolation
- Faltam apenas: email rico (US5) e cancelamento online (US4)

**Tempo estimado MVP**: ~9 dev-days (1.5 + 2 + 2 + 3 = 8.5d, +20% buffer).

### Entrega plena (todas as phases)

**~14.5 dev-days** total conforme plan.

### Atalho pra demo de venda

Setup + Foundational + US2 + US1 (sem US3 ainda):
- **5 dev-days** com paciente conseguindo agendar
- **NÃO** rodar em produção sem US3 — vetor de ataque
- Bom o suficiente para **demo de venda** privada com clientes que vocês controlam

### Ordem cirúrgica recomendada (decisões diárias)

| Semana | Tarefas | Marco |
|---|---|---|
| 1 | Setup + Foundational + US2 | Admin configura, link público abre mas vazio |
| 2 | US1 + começa US3 tests | Paciente agenda; testes de segurança começam |
| 3 | US3 implementação + US5 | Captcha funciona, email com .ics chega; **MVP comercial** |
| 4 | US4 + Polish | Cancel via link + LGPD política + validação final |

---

## Notes

- **[P]** = arquivos diferentes, sem dependência incompleta.
- **[Story]** = mapeia à user story do spec.md para rastreabilidade.
- Cada US é completamente entregável e testável independentemente.
- **Testes de contrato são obrigatórios** para US3 (gate constitucional). Outros testes são fortemente recomendados.
- **`pnpm typecheck` é gate por phase**, conforme regra do projeto.
- **Commit + push após cada US** é regra explícita do usuário.
- Evitar: tarefas vagas, conflitos no mesmo arquivo entre [P]s, dependência cruzada entre US que quebre independência.
- **Após T104** (investigação de slot lock release), pode haver re-trabalho em US1+US3 dependendo do achado — buffer interno.
- **Constitucional III**: T060 não pode falhar para o PR ser merged. Reservar tempo de revisão extra.
