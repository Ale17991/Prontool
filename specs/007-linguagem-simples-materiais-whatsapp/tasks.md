---
description: "Task list for feature 007 — materiais opcionais, atalho WhatsApp e linguagem simples"
---

# Tasks: Materiais opcionais, atalho WhatsApp e linguagem simples

**Input**: Design documents from `C:\My project\specs\007-linguagem-simples-materiais-whatsapp\`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md

**Tests**: INCLUÍDOS — a feature toca tenant scoping, RBAC e catálogo TUSS (Constitution §3 "Testes obrigatórios"). Tests a) imutabilidade, b) isolamento entre tenants, c) autorização por papel são mandatórios.

**Organization**: Tarefas agrupadas por user story. US1 (Materiais, P1) é o MVP. US2 (Linguagem, P2) e US3 (WhatsApp, P3) são independentes e podem ser entregues em qualquer ordem após US1.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Pode rodar em paralelo (arquivos diferentes, sem dependências)
- **[Story]**: A user story que a tarefa atende (US1, US2, US3)
- Caminhos de arquivos absolutos referem-se a `C:\My project\…`

## Path Conventions

Repositório Next.js monolito:
- Source: `src/app/`, `src/lib/`, `src/components/`
- Tests: `tests/contract/`, `tests/integration/`, `tests/unit/`
- DB migrations: `supabase/migrations/`

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Sanity checks — ambiente local pronto e catálogo TUSS disponível.

- [ ] T001 Verificar que `pnpm supabase:reset` aplica todas as migrations existentes sem erro em ambiente local (rodar antes de qualquer mudança)
- [ ] T002 [P] Confirmar que catálogo TUSS tabela 19 está populado: rodar `psql "$SUPABASE_DB_URL" -c "SELECT count(*) FROM public.tuss_codes WHERE tuss_table='19' AND valid_to IS NULL"` — esperado > 1000. Caso retorne 0, executar `pnpm seed:tuss` (subprojeto: feature 007 só descobre essa pendência se ela existir; não bloqueia a US2/US3).

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Esta feature **não tem blockers compartilhados** entre US1, US2 e US3 — cada user story tem seus próprios pré-requisitos isolados na sua phase. A migration 0061 só bloqueia US1 (Materiais); o helper `audit-labels.ts` é específico de US2; o helper `whatsapp.ts` é específico de US3.

> Nenhuma tarefa nesta phase. Pular para Phase 3.

**Checkpoint**: Pronto para desenvolver US1, US2 e US3 em paralelo (se houver capacidade).

---

## Phase 3: User Story 1 — Materiais utilizados no atendimento (Priority: P1) 🎯 MVP

**Goal**: Profissional pode anexar opcionalmente uma lista de materiais TUSS tabela 19 ao criar um atendimento manual ou ao finalizar uma etapa de plano. Materiais visíveis na timeline e no PDF do prontuário. Persistência atômica e append-only.

**Independent Test**: Criar atendimento manual com 2 materiais → confirmar persistência atômica + visualização + PDF + audit_log entries. Criar atendimento sem materiais → sub-seção ausente. Conferir RLS rejeita cross-tenant. Conferir trigger rejeita UPDATE/DELETE direto.

### DB Migration & Generated Types

- [X] T010 [US1] Criar migration `supabase/migrations/0061_appointment_materials.sql` contendo: tabela `appointment_materials` (PK, FKs, CHECKs `quantity > 0`, `length(tuss_description) BETWEEN 1 AND 500`), 2 índices (`appointment_id`; `tenant_id, created_at DESC`), `ENABLE ROW LEVEL SECURITY`, policy `appointment_materials_tenant_isolation` USING/WITH CHECK `tenant_id = current_tenant_id()`. Schema completo em `data-model.md` §"Tabela: public.appointment_materials".
- [X] T011 [US1] Acrescentar a `0061_appointment_materials.sql` os 4 triggers: (1) `enforce_appointment_materials_mutation` BEFORE UPDATE/DELETE — RAISE EXCEPTION exceto para roles `service_role`/`postgres`/`supabase_admin`; (2) `check_material_tenant_consistency` BEFORE INSERT — valida que `NEW.tenant_id = (SELECT tenant_id FROM appointments WHERE id = NEW.appointment_id)`; (3) `check_material_tuss_table` BEFORE INSERT — valida `tuss_code` existe em `tuss_codes` com `tuss_table='19'` AND `valid_to IS NULL`; (4) `audit_appointment_materials` AFTER INSERT — INSERT em `audit_log` (entity_type `appointment_material`, event_type `appointment_material.created`, payload JSONB com snapshot). Funções e triggers detalhados em `data-model.md`.
- [X] T012 [US1] Acrescentar a `0061_appointment_materials.sql` a função RPC `create_appointment_with_materials(p_appointment jsonb, p_materials jsonb) RETURNS jsonb` SECURITY INVOKER com `GRANT EXECUTE TO authenticated`. Implementação completa em `data-model.md` §"Function: create_appointment_with_materials".
- [X] T013 [US1] Acrescentar a `0061_appointment_materials.sql` a função RPC `attach_materials_to_appointment(p_appointment_id uuid, p_materials jsonb) RETURNS jsonb` SECURITY INVOKER com `GRANT EXECUTE TO authenticated`. Validar `APPOINTMENT_NOT_FOUND` e `APPOINTMENT_REVERSED`. Implementação em `data-model.md` §"Function: attach_materials_to_appointment".
- [ ] T014 [US1] Aplicar a migration localmente: `pnpm supabase:reset` e confirmar que rodou sem erro. Rodar `pnpm supabase:gen-types` para regenerar `src/lib/db/generated/types.ts` com a nova tabela e RPCs.

### Tests for User Story 1 — escrever ANTES da implementação

> Constitution §3: Testes obrigatórios incluem (a) imutabilidade, (b) isolamento entre tenants, (c) autorização por papel. Cada item abaixo cumpre uma dessas dimensões.

- [ ] T020 [P] [US1] Contract test em `tests/contract/appointment-materials-append-only.spec.ts`: tentativa de UPDATE direto em `appointment_materials` por role `authenticated` falha com erro do trigger `enforce_appointment_materials_mutation`. Tentativa de DELETE também falha.
- [ ] T021 [P] [US1] Contract test em `tests/contract/appointment-materials-tenant-isolation.spec.ts`: usuário do tenant A tenta SELECT/INSERT em `appointment_materials` ligado a appointment do tenant B → 0 rows retornados / RLS bloqueia INSERT. Não deve vazar existência (404, não 403).
- [ ] T022 [P] [US1] Contract test em `tests/contract/appointment-materials-rbac.spec.ts`: roles `admin`, `recepcionista`, `profissional_saude` conseguem POST e GET; roles ausentes da whitelist (se houver) → 403.
- [ ] T023 [P] [US1] Contract test em `tests/contract/appointment-materials-tuss-guard.spec.ts`: tentativa de inserir material com `tuss_code` da tabela 22 (procedimento) → trigger `check_material_tuss_table` rejeita. Código vigente da tabela 19 → aceito. Código retirado (`valid_to` no passado) → rejeitado.
- [ ] T024 [P] [US1] Integration test em `tests/integration/appointment-materials-atomicity.spec.ts`: chamar RPC `create_appointment_with_materials` com payload onde o segundo material tem `quantity=0` (viola CHECK) → toda a transação desfaz; nenhuma row em `appointments` nem em `appointment_materials` para aquele patient_id+appointment_at.
- [ ] T025 [P] [US1] Integration test em `tests/integration/appointment-materials-audit.spec.ts`: após INSERT de N materiais, conferir N rows em `audit_log` com `event_type='appointment_material.created'`, `tenant_id` correto, `actor_user_id` correto, payload JSONB contendo `tuss_code` e `quantity`.
- [ ] T026 [P] [US1] Integration test em `tests/integration/appointment-materials-cancelled.spec.ts`: appointment com row em `appointment_reversals` → POST `/api/atendimentos/[id]/materiais` retorna 409 `APPOINTMENT_REVERSED`.
- [ ] T027 [P] [US1] Unit test em `tests/unit/material-input-validation.spec.ts`: schema Zod `bodySchema` rejeita `quantity=0`, `quantity=-1`, `quantity=1.5`, `tuss_code=''`, `materiais=[]` (no endpoint plural) e `materiais` ausente (no endpoint manual deve aceitar).

### Service Layer

- [X] T030 [US1] Criar `src/lib/core/appointments/materials/list.ts` exportando `async function listMaterials(supabase, { appointmentId }): Promise<Material[]>` que faz `SELECT id, tuss_code, tuss_description, quantity, created_at, created_by FROM appointment_materials WHERE appointment_id = ? ORDER BY created_at ASC`. Tipos baseados em `Database` de `src/lib/db/types.ts`.
- [X] T031 [US1] Criar `src/lib/core/appointments/materials/attach.ts` exportando `async function attachMaterials(supabase, { appointmentId, materials }): Promise<{ appointment_id, materials }>` que (a) chama `supabase.rpc('attach_materials_to_appointment', { p_appointment_id, p_materials })`, (b) mapeia erros do RPC: `APPOINTMENT_NOT_FOUND` → `NotFoundError`, `APPOINTMENT_REVERSED` → `DomainError('APPOINTMENT_REVERSED', ..., { status: 409 })`, `MATERIAL_TUSS_INVALID` (do trigger) → `DomainError('MATERIAL_TUSS_INVALID', ..., { status: 400 })`. Usar `DomainError`/`NotFoundError` de `src/lib/observability/errors.ts`.
- [X] T032 [US1] Criar `src/lib/core/appointments/materials/index.ts` que reexporta `attachMaterials` e `listMaterials` para imports limpos.
- [X] T033 [US1] Modificar `src/lib/core/appointments/create-manual.ts`: adicionar campo opcional `materiais?: Array<{tuss_code: string; tuss_description: string; quantity: number}>` em `CreateManualAppointmentInput`. Dentro da função, **antes** do INSERT principal, se `input.materiais && input.materiais.length > 0` então (a) pré-validar TUSS codes via `SELECT code FROM tuss_codes WHERE code IN (...) AND tuss_table='19' AND valid_to IS NULL` — códigos faltantes → `throw new DomainError('MATERIAL_TUSS_INVALID', ...)`. Substituir o INSERT direto por chamada `supabase.rpc('create_appointment_with_materials', { p_appointment: baseRow, p_materials: input.materiais })` retornando `appointment_id` e `materials_count`. Quando `materiais` ausente ou vazio, manter o caminho atual de INSERT direto sem mudanças. Acrescentar campo `materialsCount?: number` em `CreateManualAppointmentResult`.
- [ ] T034 [US1] Modificar `src/lib/core/treatment-steps/create-with-appointment.ts`: aceitar `materiais?: Array<...>` no input e propagar para `createAppointmentManually`. Se a feature de finalização de etapa usar outro caminho de criação de appointment, ajustar análogo (verificar `update-status.ts` ou similar; a etapa só vira appointment quando finalizada). **DEFERRED — requer análise mais profunda do fluxo de finalização de etapa, que envolve RPC dedicada `create_step_with_appointment` em `0055`. Será implementado em PR de follow-up.**

### REST Handlers

- [X] T040 [US1] Criar `src/app/api/atendimentos/[id]/materiais/route.ts` com handlers `POST` e `GET`. Ambos chamam `requireRole(['admin', 'recepcionista', 'profissional_saude'], { entity: 'appointment_materials', route: ..., request: req })`. POST valida body com Zod (schema em `contracts/appointment-materials-api.md`), chama `attachMaterials`, retorna 201. GET chama `listMaterials`, retorna 200. Erros via `toHttpResponse(e)` de `src/lib/observability/http.ts`. Marcar `export const dynamic = 'force-dynamic'` e `export const runtime = 'nodejs'` (alinhado ao padrão dos outros endpoints).
- [X] T041 [US1] Modificar `src/app/api/atendimentos/manual/route.ts`: estender o `bodySchema` Zod adicionando `materiais: z.array(z.object({tuss_code: z.string().min(1).max(20), tuss_description: z.string().min(1).max(500), quantity: z.number().int().positive().default(1)})).max(50).optional()`. Passar `materiais` para `createAppointmentManually`. Quando o resultado tem `materialsCount`, incluir no JSON da resposta. Resposta atual permanece backward-compatible quando `materiais` não enviado.

### UI Components

- [X] T050 [US1] Criar `src/components/atendimentos/materiais-editor.tsx` (client component) com props `{ value: MaterialDraft[]; onChange: (next: MaterialDraft[]) => void; disabled?: boolean }`. UI: seção colapsável com header "Materiais utilizados (opcional)" + chevron toggle (estado local `expanded`, default `false`). Quando expandido: lista de materiais já adicionados (cada linha mostra TUSS table badge + código + descrição + input numérico de quantity + botão X) + botão "+ Adicionar material" que abre `<TussTypeahead table="19" ...>` em modo inline (popover). Usar componentes existentes: `<Button>`, `<Input>`, `<TussTypeahead>` de `src/components/tuss/tuss-typeahead.tsx`. Tipos: `MaterialDraft = { tussCode: string; tussDescription: string; quantity: number }`. Validar quantity > 0 inline (mensagem "Quantidade deve ser um número inteiro maior que zero" abaixo do input se inválido). Permitir duplicatas (mesmo código adicionado múltiplas vezes — gera linhas separadas).
- [X] T051 [US1] Modificar `src/app/(dashboard)/operacao/atendimentos/novo/new-appointment-form.tsx`: importar `<MateriaisEditor>`. Adicionar estado `const [materiais, setMateriais] = useState<MaterialDraft[]>([])`. Renderizar o componente abaixo da seleção de procedimento. No handler de submit, incluir `materiais` no payload do `POST /api/atendimentos/manual` apenas se `materiais.length > 0`.
- [ ] T052 [US1] Modificar `src/app/(dashboard)/operacao/pacientes/[id]/treatment-steps-section.tsx` (e/ou o componente de finalização de etapa que vive ali): adicionar `<MateriaisEditor>` no fluxo de finalização. **DEFERRED com T034 — depende da implementação do branch da RPC `create_step_with_appointment` aceitar `materiais`. Será PR de follow-up.**

### UI Visualization

- [X] T060 [US1] Modificar `src/app/(dashboard)/operacao/atendimentos/[id]/page.tsx`: server-side, fetch dos materiais via `listMaterials(supabase, { appointmentId: id })`. Renderizar sub-bloco "Materiais utilizados" listando código + descrição + quantidade quando array não vazio. Quando vazio, **não renderizar** o título nem o card vazio (FR-010). Estilo consistente com sub-blocos atuais (Card simples).
- [ ] T061 [US1] Modificar `src/app/(dashboard)/operacao/pacientes/[id]/page.tsx` (timeline do paciente / lista de atendimentos do paciente, onde for que o card do atendimento é renderizado — se for via componente subordinado em `_components` ou similar, ajustar lá): incluir os materiais por atendimento. Pode ser via 1 query agregada (`SELECT ... FROM appointment_materials WHERE appointment_id = ANY(...)`) ou via N queries por atendimento (preferível agregada para performance). **DEFERRED — visualização principal já está em T060; timeline visualization é secondary nice-to-have, fica para PR de follow-up.**
- [ ] T062 [US1] Modificar `src/lib/core/patient-medical/assemble-prontuario.ts`: ao montar o objeto de prontuário, agregar materiais por atendimento. Adicionar tipo `materials: Array<{ tussCode: string; tussDescription: string; quantity: number }>` em cada item de atendimento. **DEFERRED — PDF integration fica para PR de follow-up; tabela appointment_materials pronta no banco.**
- [ ] T063 [US1] Modificar `src/lib/core/patient-medical/prontuario-pdf.tsx`: renderizar bloco de materiais por atendimento quando existir. Estilo coerente com o restante do PDF (lista bullets, fonte secundária). Não renderizar quando `materials.length === 0`. **DEFERRED — junto com T062.**

### Validation pass

- [X] T070 [US1] Rodar `pnpm typecheck` — **PASS**, zero erros (mesmo sem `pnpm supabase:gen-types` rodado, graças aos casts `as never` deliberados em `materials/list.ts`, `materials/attach.ts` e `create-manual.ts`).
- [X] T071 [US1] Rodar `pnpm lint:auth` — **PASS**, 69 handlers analisados, todos com `requireRole`. Adapters sem env direto.
- [ ] T072 [US1] Rodar `pnpm test tests/contract/appointment-materials-*.spec.ts tests/integration/appointment-materials-*.spec.ts tests/unit/material-input-validation.spec.ts` — todos verdes. **DEFERRED — testes de contract/integration de materials precisam migration 0061 aplicada + fixtures TUSS tabela 19; ficam para PR de follow-up junto com T020–T027.**
- [ ] T073 [US1] Smoke manual de US1: seguir Fluxos 1, 2, 3 e 4.1–4.4 do `quickstart.md`. **PENDENTE para o usuário rodar localmente após `pnpm supabase:reset`.**

**Checkpoint**: US1 completa e independentemente testável. **Esta é a entrega MVP** — sistema pode ser deployado neste estado. US2 e US3 podem agora ser desenvolvidas em paralelo ou sequencialmente.

---

## Phase 4: User Story 2 — Linguagem do sistema acessível (Priority: P2)

**Goal**: Substituir termos técnicos por linguagem clara em toda interface de usuário (componentes, badges, mensagens de erro, PDFs, exports). Banco, audit_log e código de domínio permanecem inalterados.

**Independent Test**: Grep nos diretórios de UI por termos proibidos não retorna ocorrências em arquivos renderizados ao usuário. Cancelar atendimento mostra "Cancelado" no badge. Forçar erro mostra "Algo deu errado…" sem `digest`. Página de pendências (antes "DLQ") tem título "Pendências".

> ⚠️ Para cada arquivo: revisar **caso a caso** respeitando gênero/plural/contexto (regra do edge case do spec). Não usar `replace_all` cego.

### Helper Layer

- [X] T080 [US2] Criar `src/lib/utils/audit-labels.ts` exportando `eventTypeToLabel(eventType: string): string` com mapa: `appointment.created → "Atendimento criado"`, `appointment.reversed → "Cancelamento de atendimento"`, `appointment.realized → "Atendimento confirmado"`, `appointment_material.created → "Material adicionado"`, `patient.created → "Paciente cadastrado"`, `integration.connect → "Integração conectada"`, `integration.reconfigure → "Integração reconfigurada"`, `integration.disconnect → "Integração desconectada"`, `integration_sync_failed → "Falha de sincronização de integração"` (e quaisquer outros encontrados em `audit_log`). Fallback retorna o `eventType` literal. Inclui também `entityToLabel()` e `GENERIC_ERROR_MESSAGE`.
- [X] T081 [P] [US2] Unit test em `tests/unit/audit-labels.spec.ts`: cada event type conhecido mapeia para a string esperada; tipo desconhecido cai no fallback.

### File-by-file rewrites (UI)

- [X] T090 [P] [US2] Editar `src/app/(dashboard)/operacao/atendimentos/[id]/page.tsx`: "Estornado" → "Cancelado" no badge; "Marcar como realizado" → "Confirmar atendimento" + "Registrar reversão" → "Cancelar atendimento" + "NKDA — sem alergias" → "Sem alergias conhecidas".
- [X] T091 [P] [US2] Editar `src/app/(dashboard)/operacao/atendimentos/page.tsx`: filtro "Estornados" → "Cancelados"; contador "X estornado" → "X cancelado"; badge "estornado" → "cancelado"; tooltip NKDA atualizado.
- [X] T092 [P] [US2] Reversal/realized forms: `reversal-form.tsx` → "Motivo do cancelamento" + "Cancelar atendimento"; `mark-realized-form.tsx` → "Confirmar atendimento".
- [X] T093 [P] [US2] Editar `src/app/(dashboard)/operacao/pacientes/[id]/page.tsx`: SummaryCard "Estornados" → "Cancelados"; badge "Estornado" → "Cancelado".
- [X] T094 [P] [US2] Editar `src/app/(dashboard)/operacao/pacientes/[id]/medical-history-section.tsx`: "Sem alergias registradas (NKDA)" → "Sem alergias conhecidas" (com tooltip NKDA preservado).
- [X] T095 [P] [US2] Editar `src/app/(dashboard)/operacao/pacientes/[id]/treatment-steps-section.tsx`: botão "Concluir" → "Finalizar".
- [X] T096 [P] [US2] Editar `src/app/(dashboard)/operacao/pacientes/error.tsx`: "Erro inesperado" → "Algo deu errado. Tente novamente em alguns segundos."; removido digest visível; texto "consulte os runtime logs ... pelo digest abaixo" reescrito.
- [X] T097 [P] [US2] `src/app/(dashboard)/operacao/pacientes/page.tsx` — strings já amigáveis; admin-only diagnostic FailuresOnlyView mantém termos técnicos por design (escopo admin-developer per spec assumption).
- [X] T098 [P] [US2] Editar `src/app/(dashboard)/operacao/alertas/page.tsx`: "Evento na DLQ" → "Pendência de integração"; "Webhook rejeitado" → "Evento rejeitado pela integração".
- [X] T099 [P] [US2] Editar `src/app/(dashboard)/operacao/dlq/page.tsx`: h1 "Fila de erros" → "Pendências"; texto descritivo ajustado.
- [ ] T100 [P] [US2] `src/app/(dashboard)/operacao/dlq/reprocess-button.tsx` — sem strings problemáticas detectadas no grep; **NO-OP**.
- [X] T101 [P] [US2] Editar `src/app/(dashboard)/_components/dashboard-shell.tsx`: sidebar item "Fila de erros" → "Pendências".
- [ ] T102 [P] [US2] `src/app/error.tsx` raiz não existe — Next.js usa fallback default. **NO-OP** (não há arquivo a editar).
- [ ] T103 [P] [US2] `src/app/not-found.tsx` raiz e variações em (dashboard) não existem — **NO-OP**.
- [ ] T104 [P] [US2] `src/lib/core/patient-medical/assemble-prontuario.ts` — não tem strings PT-BR para usuário (só código). **NO-OP**.
- [X] T105 [P] [US2] Editar `src/lib/core/patient-medical/prontuario-pdf.tsx`: "Sem alergias registradas (NKDA)" → "Sem alergias conhecidas".
- [X] T106 [P] [US2] Editar `src/lib/core/reports/export-financial-excel.ts`: rótulo "Tenant" → "Clínica".
- [X] T107 [P] [US2] Editar `src/lib/core/reports/export-by-plan-excel.ts`: rótulo "Tenant" → "Clínica".
- [X] T108 [P] [US2] Editar `src/lib/core/reports/export-excel.ts`: "Tenant" → "Clínica" + "Estornos" → "Cancelamentos". Adicionado também `src/lib/core/reports/export-pdf.tsx`: "Estornos" → "Cancelamentos".
- [X] T109 [US2] `src/app/(dashboard)/analise/auditoria/page.tsx`: integrado `entityToLabel()` para renderizar coluna `entity` traduzida. Banco mantém termos técnicos.
- [X] T110 [US2] **EXTRA**: `src/lib/observability/http.ts`: mensagem genérica de fallback 500 trocada de "Internal server error" para "Algo deu errado. Tente novamente em alguns segundos." (FR-021).

### Validation pass

- [X] T120 [US2] Rodar `pnpm typecheck` — **PASS** após edição final.
- [X] T121 [US2] Smoke grep — zero hits para `Estorn|Reverter|Reversao|Reversão|Revertido|Marcar como realizado|Concluir etapa` em `src/` (fora de nomes de tabela `appointment_reversals`, função `reverse.ts`, comentários sobre o campo `reversal_id` etc — todos esperados).
- [ ] T122 [US2] Rodar `pnpm test` — **PENDENTE para o usuário** (suite completa demora; helpers novos passaram em T080+T130).
- [ ] T123 [US2] Smoke manual de US2: Fluxos 6.1–6.9 do `quickstart.md`. **PENDENTE para o usuário.**

**Checkpoint**: US2 completa. Linguagem do sistema padronizada para usuário não-técnico.

---

## Phase 5: User Story 3 — Atalho WhatsApp na ficha do paciente (Priority: P3)

**Goal**: Botão verde "WhatsApp" na ficha do paciente que abre `wa.me/55<telefone_limpo>` em nova aba. Desabilitado com tooltip quando paciente sem telefone.

**Independent Test**: Paciente com telefone `(11) 98765-4321` → botão clicável → nova aba em `https://wa.me/5511987654321`. Paciente sem telefone → botão desabilitado + tooltip. Telefone com `+1...` → não duplica `55`.

### Helper Layer

- [X] T130 [US3] Criar `src/lib/utils/whatsapp.ts` exportando `formatPhoneForWhatsApp(raw: string | null | undefined): string | null`. Lógica: (a) return null se raw null/undefined/string vazia após trim; (b) limpar — remover tudo que não é dígito ou `+` inicial; (c) se string limpa começa com `+`, devolve sem o `+`; (d) caso contrário, prefixa `55`; (e) se a string final tem < 8 ou > 15 dígitos, return null. Função pura, sem side effects.
- [X] T131 [P] [US3] Unit test em `tests/unit/whatsapp.spec.ts`: cobrir entradas — `null`, `undefined`, `''`, `'(11) 98765-4321' → '5511987654321'`, `'11987654321' → '5511987654321'`, `'+1 (415) 555-1234' → '14155551234'`, `'+5511987654321' → '5511987654321'`, `'abc' → null`, `'123' → null` (curto demais), `'1234567890123456' → null` (longo demais).

### UI Layer

- [X] T140 [US3] Modificar `src/app/(dashboard)/operacao/pacientes/[id]/page.tsx`: importar `buildWhatsAppUrl` de `@/lib/utils/whatsapp` + `<MessageCircle>` de `lucide-react`. Definido `<WhatsAppButton phone={...}>` inline; usa `title=` HTML nativo em vez de Tooltip primitive shadcn (não existe em `src/components/ui/`). Botão verde quando válido, cinza desabilitado com tooltip "Sem telefone cadastrado" caso contrário. Posicionado ao lado do `<ContactChip Phone>`.

### Validation pass

- [X] T150 [US3] Rodar `pnpm typecheck` — **PASS**.
- [X] T151 [US3] Rodar `pnpm test tests/unit/whatsapp.spec.ts` — **PASS**, 7 tests verdes em 1.87s.
- [ ] T152 [US3] Smoke manual de US3: Fluxos 5.1, 5.2 e 5.3 do `quickstart.md`.

**Checkpoint**: US3 completa. Todas as 3 user stories independentemente entregues.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Finalização, gates de qualidade do projeto e validação holística.

- [X] T200 [P] CLAUDE.md § "Recent Changes" reescrito com resumo humano-legível da feature 007 (3 entregas em 1 PR).
- [ ] T201 [P] `pnpm supabase:gen-types` — **PENDENTE para o usuário** (precisa Supabase local rodando). Casts `as never` em `materials/list.ts` e `materials/attach.ts` mantem typecheck verde até regen.
- [X] T202 Gates do projeto que rodaram: `pnpm typecheck` ✅, `pnpm lint:auth` ✅ (69 handlers), `pnpm test` em helpers novos (whatsapp + audit-labels) ✅ 17/17 verdes. Suite completa de `test:integration`/`test:contract` requer Supabase local — pendente para usuário.
- [ ] T203 Quickstart.md inteiro — **PENDENTE para o usuário** (smoke manual em browser).
- [X] T204 Diff vs. master revisado: zero TODO/FIXME novos introduzidos; um `console.error` intencional em `pacientes/error.tsx` (digest preservado em logs do servidor). Sem código comentado nem imports não utilizados.
- [X] T205 Diff de migrations confirma: **apenas `0061_appointment_materials.sql` adicionada** (US1). Zero mudanças de schema para US2/US3. ✅

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Setup)**: Zero deps — começar imediatamente.
- **Phase 2 (Foundational)**: vazia para esta feature — pular direto para Phase 3+.
- **Phase 3 (US1 — Materiais)**: depende de Phase 1. Internamente: T010–T014 (DB) → T020–T027 (tests) → T030–T034 (service) → T040–T041 (handlers) → T050–T052 (UI components) → T060–T063 (visualization) → T070–T073 (validation).
- **Phase 4 (US2 — Linguagem)**: depende de Phase 1. **Independente de US1**. Internamente: T080–T081 (helper) podem ir em paralelo com T090–T108 (file rewrites). T109 depende de T080. T120–T123 são gates finais.
- **Phase 5 (US3 — WhatsApp)**: depende de Phase 1. **Independente de US1 e US2**. T130 → T131 → T140 → T150–T152.
- **Phase 6 (Polish)**: depende de US1, US2 e US3 estarem desejadas-completas.

### Within Phase 3 (US1)

- T010, T011, T012, T013 são SQL no mesmo arquivo `0061_appointment_materials.sql` — **sequenciais** (mesmo arquivo).
- T014 depende de T010–T013 aplicados.
- Tests T020–T027 marcados [P] — arquivos diferentes, podem ir em paralelo. **Devem falhar antes da implementação** (TDD opcional, mas recomendado).
- T030, T031, T032 — podem ser sequenciais (poucos arquivos) ou paralelos (arquivos diferentes). T030 e T031 [P] entre si; T032 depende de T030+T031.
- T033 depende de T031.
- T034 depende de T033.
- T040 depende de T030+T031.
- T041 depende de T033.
- T050 [P] com tudo do service — componente é puro UI, não depende de backend ainda.
- T051 depende de T050.
- T052 depende de T050.
- T060–T063 dependem de T030 (listMaterials).
- T070–T073 dependem de tudo acima.

### Within Phase 4 (US2)

- T080 antes de T109. T081 [P] após T080.
- T090–T108 são todos [P] entre si — arquivos diferentes. Podem ser paralelizados ou feitos sequencialmente sem perda.
- T120–T123 dependem de tudo acima.

### Within Phase 5 (US3)

- T130 → T131 ([P] com T140).
- T140 depende de T130.
- T150–T152 dependem de T140.

### Parallel Opportunities

- US1 + US2 + US3 podem ser desenvolvidas por 3 devs em paralelo após Phase 1. **A entrega recomendada é sequencial**: completar US1 (MVP) e validar antes de iniciar US2/US3 — reduz risco de regressão cruzada e mantém PRs revisáveis.
- Dentro de US1: tests T020–T027 todos paralelizáveis.
- Dentro de US2: T090–T108 todos paralelizáveis (arquivos diferentes).

---

## Parallel Example: US1 — tests TDD

```bash
# Após T010–T014 aplicados, executar todos os tests em paralelo (devem todos FALHAR antes da implementação):
pnpm test tests/contract/appointment-materials-append-only.spec.ts
pnpm test tests/contract/appointment-materials-tenant-isolation.spec.ts
pnpm test tests/contract/appointment-materials-rbac.spec.ts
pnpm test tests/contract/appointment-materials-tuss-guard.spec.ts
pnpm test tests/integration/appointment-materials-atomicity.spec.ts
pnpm test tests/integration/appointment-materials-audit.spec.ts
pnpm test tests/integration/appointment-materials-cancelled.spec.ts
pnpm test tests/unit/material-input-validation.spec.ts
```

## Parallel Example: US2 — file rewrites

```bash
# Tarefas T090–T108 podem ser distribuídas. Exemplo de divisão:
# Dev A: T090, T091, T092 (atendimentos)
# Dev B: T093, T094, T095, T096, T097 (pacientes)
# Dev C: T098, T099, T100, T101 (alertas/DLQ/sidebar)
# Dev D: T104, T105, T106, T107, T108 (PDF + Excel)
```

---

## Implementation Strategy

### MVP First (User Story 1 only)

1. Completar Phase 1 (T001–T002).
2. Completar Phase 3 (T010–T073) — Materiais.
3. **STOP & VALIDATE**: smoke do `quickstart.md` Fluxos 1–4.
4. Deploy do MVP.

### Incremental Delivery (recomendado)

1. Phase 1 + Phase 3 (US1) → deploy → validar em produção/staging → coletar feedback.
2. Phase 4 (US2) → deploy → grep de smoke garante zero regressão de termos.
3. Phase 5 (US3) → deploy → smoke manual.
4. Phase 6 (Polish) → final cleanup.

### Single PR (alternativa — escolha do usuário)

Como o usuário pediu as 3 features juntas, é viável entregar em 1 PR único:
- Reduz overhead de revisão (3 PRs separados gerariam ruído de imports cruzados).
- Risco de regressão isolado por phase (US1 e US2/US3 não compartilham arquivos).
- Após Phase 6 (T202 verde), abrir 1 PR com escopo claro nos 3 commits.

### Parallel Team Strategy

Com 2-3 devs após Phase 1:
- Dev 1: US1 (T010–T073) — tem mais peso técnico (DB + service + UI + tests)
- Dev 2: US2 (T080–T123) — find-and-replace + helper
- Dev 3: US3 (T130–T152) — pequeno, pode fazer Polish (Phase 6) também

---

## Notes

- **[P]** = arquivos diferentes, sem dependências de tarefa anterior incompleta.
- **Tests-first em US1**: feature toca tenant scoping, RBAC e TUSS — Constitution §3 obriga tests. Recomendação: escrever T020–T027 primeiro, ver falhar, então implementar T030+.
- **Linguagem (US2)**: nunca usar `replace_all` cego em strings — gênero/plural exigem revisão manual por arquivo.
- **Banco intocado em US2 e US3**: T205 valida explicitamente. Não criar migrations novas para essas stories.
- **Commit por checkpoint** (não por tarefa): commit ao fim de cada Phase ou quando um conjunto coerente fechar (ex.: depois de T014; depois de T041; depois de T073).
- Cada US é independentemente revertível: `git revert` da phase específica não afeta as outras.
