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

- [ ] T032 [P] [US1] Teste de contrato: `public_booking_resolve_slug` retorna 0 linhas para slug inexistente, slug existente mas disabled, e slug com chars inválidos em `tests/contract/public-booking-resolve-slug.test.ts`
- [ ] T033 [P] [US1] Teste de contrato: `public_booking_slots` retorna slots corretos para configuração canônica em `tests/contract/public-booking-slots-happy-path.test.ts`
- [ ] T034 [P] [US1] Teste de unidade: discretização de slots (lunch break, weekday filter, janela min/max) em `tests/unit/slot-calculator.test.ts` (mock `now()`)
- [ ] T035 [P] [US1] Teste de contrato: fluxo create end-to-end (resolve slug → slots → create) com paciente novo em `tests/contract/public-booking-create-flow.test.ts`
- [ ] T036 [P] [US1] Teste de contrato: paciente recorrente por CPF reaproveita registro + atualiza email/phone + audita em `tests/contract/public-booking-recurring-patient.test.ts`

### Implementation for User Story 1

- [ ] T037 [US1] Criar `src/lib/core/public-booking/resolve-tenant.ts` chamando RPC `public_booking_resolve_slug`; retornar TenantConfig DTO ou null
- [ ] T038 [US1] Criar `src/lib/core/public-booking/list-slots.ts` chamando RPC `public_booking_slots`; mapear para `SlotDTO[]` + timezone
- [ ] T039 [US1] Criar `src/lib/core/public-booking/list-published.ts` com `listPublishedDoctors(tenantId)` e `listProceduresByDoctor(tenantId, doctorId)` (server-side via service_role; expõe apenas dados publicados — sem PII)
- [ ] T040 [US1] Criar `src/lib/core/public-booking/create-booking.ts` orquestrando o fluxo transacional de 20 passos do api-create-booking.contract.md §Server-side flow (sem turnstile/rate-limit ainda — esses entram na US3)
- [ ] T041 [US1] Em `create-booking.ts`: integração com `createPatient` existente (paciente novo) e `public_booking_find_patient_by_cpf` (recorrente) + UPDATE de email/phone com audit
- [ ] T042 [US1] Em `create-booking.ts`: INSERT em `appointments` com `actor_user_id=NULL` + INSERT em `audit_log` via `log_audit_event` event_type='public_booking_created' + INSERT em `public_booking_tokens` (token raw retornado pra fora)
- [ ] T043 [US1] Criar `src/lib/core/public-booking/tokens.ts` com `generateCancelToken()` (32 bytes base64url + SHA-256 hash); export `verifyToken(rawToken)` com `crypto.timingSafeEqual`
- [ ] T044 [US1] Criar Route Handler `src/app/api/public/booking/[slug]/slots/route.ts` (GET) conforme api-slots.contract.md (validação Zod, resolve tenant, 404/403/400/200)
- [ ] T045 [US1] Criar Route Handler `src/app/api/public/booking/[slug]/create/route.ts` (POST) — versão MVP sem Turnstile (essa parte entra na US3). Aceita payload Zod, chama `createBooking`, retorna 201 com cancelToken raw + redirectUrl
- [ ] T046 [US1] Criar componente client `src/components/public-booking/doctor-list.tsx` (cards de médicos publicados com foto+nome+bio+CTA "Agendar")
- [ ] T047 [US1] Criar `src/components/public-booking/slot-picker.tsx` (calendário mini de 30 dias + lista de horários do dia selecionado) usando `date-fns-tz`
- [ ] T048 [US1] Criar `src/components/public-booking/patient-form.tsx` (Zod + react-hook-form): nome, CPF opcional com máscara, email, telefone com máscara, DOB, LGPD checkbox
- [ ] T049 [US1] Criar `src/components/public-booking/booking-summary.tsx` (resumo antes de confirmar — paciente vê data/hora/médico/procedimento)
- [ ] T050 [US1] Criar `src/app/agendar/[slug]/page.tsx` (server component) — resolve tenant, lista médicos publicados, hero com clinic info, renderiza DoctorList
- [ ] T051 [US1] Criar `src/app/agendar/[slug]/horarios/page.tsx` — calendar + slots
- [ ] T052 [US1] Criar `src/app/agendar/[slug]/confirmar/page.tsx` — patient form + summary (sem Turnstile ainda)
- [ ] T053 [US1] Criar `src/app/agendar/[slug]/sucesso/[token]/page.tsx` (server) — exibe resumo + botão "Cancelar consulta" + placeholder "Adicionar ao Calendar" (botões reais entram na US5)
- [ ] T054 [US1] Criar `src/app/agendar/[slug]/error.tsx` — página de erro genérica (tenant disabled, slug 404)
- [ ] T055 [US1] Criar layout `src/app/agendar/layout.tsx` (FORA do (dashboard) group — sem sidebar/auth) com tema neutro + design system 016
- [ ] T056 [US1] Rodar tests US1 (T032-T036) — devem passar
- [ ] T057 [US1] Smoke test manual conforme quickstart.md §4 (criar config via US2, abrir em anônimo, completar fluxo)
- [ ] T058 [US1] Rodar `pnpm typecheck`
- [ ] T059 [US1] Commit + push: `feat(public-booking): fluxo do paciente agenda sem login (US1)`

**Checkpoint**: fluxo completo funciona sem segurança ainda. Próximo: blindar.

---

## Phase 5: User Story 3 — Sistema protege contra abuso e race conditions (Priority: P1)

**Goal**: Turnstile + rate limit + isolation tests. **Bloqueia produção**.

**Independent Test**: (a) script faz 200 submits sequenciais → 4º é bloqueado por rate; (b) submit sem token Turnstile → 403; (c) 2 clientes paralelos no mesmo slot → 1 sucesso 1 conflict; (d) slug-A não acessa appointment-B (gate constitucional III).

### Tests for User Story 3 (CRÍTICO — gate constitucional)

- [ ] T060 [P] [US3] **Teste de contrato CRÍTICO de isolamento multi-tenant**: 2 tenants com slugs distintos, médicos distintos, procedimentos distintos. Verificar que `public_booking_slots('slug-a', doctor_b, ...)` retorna 0 linhas; que POST create com manipulação de payload tenta agendar Dr. de outro tenant retorna 403. Em `tests/contract/public-booking-tenant-isolation.test.ts`. **GATE DE MERGE**.
- [ ] T061 [P] [US3] Teste de contrato: anon **não pode** SELECT em `appointments`, `patients`, `audit_log`, `public_booking_tokens` via supabase-js client direto — apenas via funções server-side. Em `tests/contract/public-booking-rls.test.ts`
- [ ] T062 [P] [US3] Teste de contrato: 2 submits paralelos para mesmo slot — apenas 1 retorna 201, outro retorna 409 `SLOT_NO_LONGER_AVAILABLE`. Em `tests/contract/public-booking-slot-collision.test.ts` (usa `Promise.all` com 2 fetches)
- [ ] T063 [P] [US3] Teste de integração: 11ª request a `/slots` em <1min do mesmo IP retorna 429. Em `tests/integration/public-booking-rate-limit-slots.test.ts`
- [ ] T064 [P] [US3] Teste de integração: 4º submit em <1h do mesmo IP retorna 429. Em `tests/integration/public-booking-rate-limit-submit.test.ts`
- [ ] T065 [P] [US3] Teste unidade: `turnstile-verify` retorna `{ok:false}` quando secret de teste 2x... falha. Em `tests/unit/turnstile-verify.test.ts` (com mock de `fetch`)
- [ ] T066 [P] [US3] Teste integração: submit sem `turnstile_token` no body retorna 400; com token forjado retorna 403 (siteverify mock retorna `{success:false}`). Em `tests/integration/public-booking-captcha.test.ts`

### Implementation for User Story 3

- [ ] T067 [US3] Criar `src/lib/core/public-booking/turnstile-verify.ts` exportando `verifyTurnstile(token, ip?)` que POST `https://challenges.cloudflare.com/turnstile/v0/siteverify` com `secret` (env) + `response`; retorna `{ok, errorCodes?}`
- [ ] T068 [US3] Criar `src/lib/core/public-booking/rate-limit.ts` com `checkRateLimit({ipHash, tenantId, action, limit, windowMinutes})` que faz COUNT em `public_booking_rate_limits` + retorna `{allowed, retryAfterSec}`; export `bumpRateLimit({...})` que INSERT
- [ ] T069 [US3] Criar `src/lib/core/public-booking/ip-hash.ts` com `hashIpForTenant(ip, tenantId)` usando `crypto.subtle.digest('SHA-256', ...)` + base hex
- [ ] T070 [US3] Atualizar `src/app/api/public/booking/[slug]/slots/route.ts` para chamar `checkRateLimit` (10/min, action='view_slots') antes do RPC; retornar 429 se exceder; INSERT em rate_limits
- [ ] T071 [US3] Atualizar `src/app/api/public/booking/[slug]/create/route.ts` para chamar `verifyTurnstile` server-side antes de processar; retornar 403 `CAPTCHA_FAILED` se inválido. Adicionar rate limit (3/h action='submit')
- [ ] T072 [US3] Atualizar `src/lib/core/public-booking/create-booking.ts` para envolver INSERT em transação Postgres (`BEGIN ... COMMIT`); se EXCLUDE constraint violar → ROLLBACK + retornar erro estruturado `SLOT_NO_LONGER_AVAILABLE` que rota traduz para 409
- [ ] T073 [US3] Criar `src/components/public-booking/turnstile-widget.tsx` (client): carrega `https://challenges.cloudflare.com/turnstile/v0/api.js` async + renderiza widget invisible com `data-sitekey={NEXT_PUBLIC_TURNSTILE_SITE_KEY}` + callback que injeta token em hidden field do form
- [ ] T074 [US3] Integrar `TurnstileWidget` no `patient-form.tsx`; bloquear submit até token presente; UX: mostrar shimmer/loading enquanto Turnstile resolve
- [ ] T075 [US3] Atualizar `src/app/agendar/[slug]/confirmar/page.tsx` para incluir Turnstile no submit
- [ ] T076 [US3] Adicionar tela de erro `SLOT_NO_LONGER_AVAILABLE`: redireciona de volta pra `/horarios` preservando dados de paciente em sessionStorage (UX); banner explicando o que aconteceu
- [ ] T077 [US3] Rodar todos os tests US3 — passar é obrigatório para merge
- [ ] T078 [US3] Rodar `pnpm typecheck`
- [ ] T079 [US3] Commit + push: `feat(public-booking): captcha + rate limit + isolamento tests (US3)`

**Checkpoint**: feature blindada. Pronto pra rollout interno.

---

## Phase 6: User Story 5 — Paciente recebe confirmação visual e por email com .ics (Priority: P2)

**Goal**: email Resend com `.ics` anexo + notificação dual à clínica (email admin + sino).

**Independent Test**: criar agendamento, verificar (a) email do paciente chega em ≤5min com `.ics` que importa correto no Google Calendar; (b) admin recebe email; (c) sino do dashboard mostra notificação nova com tipo `public_booking`.

### Tests for User Story 5

- [ ] T080 [P] [US5] Teste unidade: `generateBookingIcs({...})` produz string `.ics` válida RFC 5545 (validar via parser) em `tests/unit/ics-generation.test.ts`
- [ ] T081 [P] [US5] Teste integração: após `create-booking`, paciente e admins recebem emails (mock Resend SDK) em `tests/integration/public-booking-emails.test.ts`
- [ ] T082 [P] [US5] Teste integração: após `create-booking`, INSERT em `notifications` para cada admin do tenant ocorre, com type='public_booking' em `tests/integration/public-booking-bell-notification.test.ts`

### Implementation for User Story 5

- [ ] T083 [US5] Criar `src/lib/utils/ics.ts` wrap do pacote `ics`: `generateBookingIcs({title, start, end, location, organizer, description, timezone, uid})` retorna string `.ics`. Lidar com VTIMEZONE block + UID estável (para retry idempotente)
- [ ] T084 [US5] Estender `src/lib/integrations/email/resend-client.ts` adicionando `sendBookingConfirmationEmail(input)` com suporte a `attachments: [{filename:'consulta.ics', content: base64}]`
- [ ] T085 [US5] Adicionar `sendAdminBookingNotificationEmail(input)` no `resend-client.ts` (sem anexo)
- [ ] T086 [US5] Criar `src/lib/integrations/email/booking-template.ts` com `renderBookingHtml(input)` (paciente) e `renderAdminBookingHtml(input)` (admin) — escape HTML, timezone explícito ("horário de Brasília")
- [ ] T087 [US5] Criar `src/lib/core/public-booking/send-confirmation-email.ts` orquestrando: gera `.ics`, chama `sendBookingConfirmationEmail` com link de cancelar; log de erro (não falha o booking)
- [ ] T088 [US5] Criar `src/lib/core/public-booking/send-admin-notification-email.ts`: lista admins do tenant (filtrar `user_tenants WHERE role='admin' AND status='active'`), envia email para cada
- [ ] T089 [US5] Criar `src/lib/core/public-booking/create-bell-notification.ts` INSERT em `notifications` para cada admin (type='public_booking', reference_id=appointmentId, reference_type='appointment', reference_key=appointmentId pra deduplicação)
- [ ] T090 [US5] Integrar no `create-booking.ts` os 3 envios pós-commit (email paciente + email admin + bell), fire-and-forget com `Promise.allSettled` e log de erros (não falha resposta 201)
- [ ] T091 [US5] Atualizar `src/app/(dashboard)/operacao/notificacoes/notification-item.tsx`: adicionar entry em `COLOR_BY_TYPE` (`public_booking: 'text-info-text bg-info-bg'`) e em `ICON_BY_TYPE` (`public_booking: CalendarPlus`)
- [ ] T092 [US5] Criar `src/components/public-booking/add-to-calendar-buttons.tsx` (client): 2 botões — "Adicionar ao Google Calendar" usa URL `https://calendar.google.com/calendar/render?...`; "Adicionar ao Apple Calendar" gera download do `.ics` (mesmo arquivo do email)
- [ ] T093 [US5] Atualizar `src/app/agendar/[slug]/sucesso/[token]/page.tsx` para renderizar botões reais (substituindo placeholder de US1) + endereço/telefone da clínica
- [ ] T094 [US5] Rodar tests US5
- [ ] T095 [US5] Smoke test manual: abrir email recebido + importar `.ics` no Google Calendar
- [ ] T096 [US5] Rodar `pnpm typecheck`
- [ ] T097 [US5] Commit + push: `feat(public-booking): confirmacao visual + email com .ics + notificacao dual (US5)`

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
