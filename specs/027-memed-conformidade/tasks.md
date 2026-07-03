---
description: 'Task list — Conformidade Memed (Checklist Pré-Produção)'
---

# Tasks: Conformidade Memed — Checklist Pré-Produção

**Input**: Design documents from `/specs/027-memed-conformidade/` (spec.md, plan.md, research.md, data-model.md, contracts/\*, quickstart.md)
**Prerequisites**: spec 026-memed-prescricao-digital deve estar pelo menos em Phase 2 (tabelas criadas) para os testes de contrato rodarem; integração/E2E podem usar mock se Phase 3+ ainda não tiver entregue endpoints.
**Tests**: incluídos — esta é uma feature de **verificação auditável**; testes são o próprio entregável.

## Format: `[ID] [P?] [Story?] Description`

- **[P]**: Pode rodar em paralelo (arquivos distintos, sem dependência incompleta)
- **[Story]**: Mapeia para US do spec.md (US1–US7)
- Setup/Foundational/Polish: sem label de story

---

## Phase 1: Setup (Infra compartilhada da suíte)

**Purpose**: Adicionar deps, criar estrutura de diretórios, registrar scripts em package.json. Tudo necessário antes de qualquer fase posterior.

- [ ] T001 Adicionar Playwright ao `package.json` como devDependency (`@playwright/test ^1.45`) e rodar `pnpm exec playwright install chromium`
- [ ] T002 [P] Verificar/adicionar MSW (`msw ^2.x`) ao `package.json` como devDependency; se já existir, anotar versão para reuso pelo mock Memed
- [ ] T003 [P] Criar estrutura de diretórios: `tests/mocks/`, `tests/e2e/`, `tools/eslint-rules/`, `tools/scripts/`, `docs/legal/`, `.github/workflows/` (criar com `.gitkeep` se vazios)
- [ ] T004 Registrar em `package.json` os 5 scripts npm: `"test:memed-conformidade"`, `"scan:memed-keys"`, `"e2e:memed"`, `"verify:memed-acceptance"`, `"memed:mock"` (sobe o mock Memed)
- [ ] T005 [P] Criar `tests/e2e/playwright.config.ts` apontando para `pnpm dev` na porta 3000, com `MEMED_BASE_URL=http://localhost:4001` injetado e timeout 90s

**Checkpoint**: ferramentas e diretórios prontos; scripts npm registrados.

---

## Phase 2: Foundational (Bloqueante — antes de qualquer story)

**Purpose**: Infra de mock + skeletons de tooling que TODAS as user stories vão exercitar. Sem isso nenhuma fase US pode rodar.

**⚠️ CRITICAL**: Nenhuma US pode começar antes desta fase.

- [ ] T006 Implementar skeleton do mock Memed em `tests/mocks/memed-mock-server.ts` — servidor HTTP com endpoints `POST /usuarios`, `GET /usuarios/{external_id}`, `GET /catalogos/especialidades`, `POST /__reset` conforme `contracts/memed-mock.md`
- [ ] T007 Implementar iframe stub estático em `tests/mocks/iframe-stub.html` — escuta `message` para `setPaciente`/`logout`; expõe `window.__emitPrescricaoImpressa`, `window.__emitPrescricaoExcluida`, `window.__emitFeatureToggle` para drive de testes E2E
- [ ] T008 [P] Skeleton de `tools/scripts/scan-bundle-for-memed-keys.ts` — assina o contrato em `contracts/credential-scan.md`: aceita `SCAN_PATH` env, exit 0/1, mascara matches no output
- [ ] T009 [P] Skeleton da regra ESLint em `tools/eslint-rules/no-memed-secrets-in-frontend.js` — exporta meta + create function vazia; registrar em `eslint.config.js` (ou `.eslintrc.cjs`) como plugin local apontando para `src/app/**`, `src/components/**`
- [ ] T010 [P] Skeleton de `tools/scripts/verify-memed-acceptance.ts` — verifica existência de `docs/legal/memed-acceptance-record.md` e presença de 9 marcadores `[x]`; exit 0/1
- [ ] T011 Estender `src/lib/observability/logger.ts` — adicionar paths `*.api_key`, `*.secret_key`, `*.apiKey`, `*.secretKey`, `config.credentials_enc` ao bloco `redact` do Pino (FR-012)

**Checkpoint**: mock funcional sobe em :4001; iframe stub renderiza; tooling skeleton aceita execução sem crash; pino redact estendido.

---

## Phase 3: User Story 1 — Cadastro do Prescritor (Priority: P1) 🎯 Bloqueante para Memed

**Goal**: provar que o payload enviado à Memed ao registrar um prescritor sempre contém os 7 campos obrigatórios e que a habilitação é bloqueada cedo se qualquer campo está vazio.

**Independent Test**: rodar `pnpm test -- memed-prescriber-payload` e confirmar: 1 caso positivo (7 campos) + 7 sub-casos negativos (cada campo faltando) passam. Sem este teste verde, Memed nega aprovação.

### Tests for User Story 1

- [ ] T012 [US1] Implementar endpoint mock `POST /usuarios` em `tests/mocks/memed-mock-server.ts` — valida 7 campos obrigatórios; retorna `201` com `{ data.attributes.token }` se completo, `422 { errors: [{ field, message }] }` se faltante
- [ ] T013 [P] [US1] Contract test em `tests/contract/memed-prescriber-payload.spec.ts` — caso positivo (doctor com 7 campos preenchidos chama mock e mock retorna 201; verificar payload enviado bate com `contracts/memed-mock.md`) + 7 sub-testes (1 por campo faltando) verificando bloqueio antes da chamada ao mock + mensagem específica
- [ ] T014 [P] [US1] Contract test em `tests/contract/memed-prescribers-status-enum.spec.ts` — verifica que CHECK constraint em `memed_prescribers.status` rejeita valores fora de `{pending, registered, error}`
- [ ] T015 [P] [US1] Contract test em `tests/contract/memed-prescribers-unique.spec.ts` — verifica UNIQUE `(tenant_id, external_id)` impede duplicação

**Checkpoint**: prescritor é provadamente registrado com payload completo OU bloqueado com mensagem clara. Critério C2/C6 da Memed coberto.

---

## Phase 4: User Story 2 — Comando SetPaciente (Priority: P1) 🎯 Bloqueante para Memed

**Goal**: provar que o `setPaciente` enviado ao iframe sempre contém os 6 campos obrigatórios do paciente e que a abertura da prescrição é bloqueada cedo se algum campo está vazio.

**Independent Test**: rodar `pnpm test -- memed-setpaciente-payload` e ver 1 positivo + 6 negativos passando. Sem este teste verde, Memed nega aprovação.

### Tests for User Story 2

- [ ] T016 [US2] Estender `tests/mocks/iframe-stub.html` — listener para `message` `setPaciente` registra payload completo em `window.__lastSetPaciente` (acessível via Playwright/Vitest jsdom)
- [ ] T017 [P] [US2] Integration test em `tests/integration/memed-setpaciente-payload.spec.ts` — positivo (paciente com 6 campos abre prescrição → mock iframe recebe `setPaciente` com 6 campos) + 6 sub-testes (1 por campo faltando) verificando bloqueio antes do iframe carregar + mensagem específica + atalho para edição do paciente

**Checkpoint**: paciente é provadamente carregado completo OU prescrição bloqueada. Critério C3 da Memed coberto.

---

## Phase 5: User Story 3 — Evento prescricaoImpressa (Priority: P1) 🎯 Bloqueante para Memed

**Goal**: provar que o evento `prescricaoImpressa` disparado pelo iframe da Memed é capturado em ≤ 5s e gera registro idempotente em `prescription_records` + entrada `audit_log`.

**Independent Test**: rodar `pnpm test -- memed-prescricaoImpressa` — ver INSERT em `prescription_records` ocorrendo, segundo INSERT idempotente, entrada `audit_log.event_type='prescription.issued'`.

### Tests for User Story 3

- [ ] T018 [US3] Estender `tests/mocks/iframe-stub.html` — função `window.__emitPrescricaoImpressa({ prescriptionId, pdfUrl? })` que dispara `parent.postMessage({ event: 'prescricaoImpressa', data: {...} })`
- [ ] T019 [P] [US3] Integration test em `tests/integration/memed-prescricaoImpressa.spec.ts` cobrindo FR-006 + FR-006a — (a) emitir evento → assert linha em `prescription_records` com `status=issued`, `memed_prescription_id`, `issued_at` em < 5s; (b) re-emitir mesmo evento → idempotência (count permanece 1); (c) simular falha de rede em todas as 3 tentativas (FR-006a) → assert backoff exponencial entre tentativas + assert `alert` criado com `type='prescription_capture_failed'`, `tenant_id`, `doctor_id`, `memed_prescription_id` + assert que UI do profissional NÃO recebe erro bloqueante
- [ ] T020 [P] [US3] Contract test em `tests/contract/memed-audit-events.spec.ts` (parte issued) — INSERT em `prescription_records (status=issued)` cria linha em `audit_log` com `event_type='prescription.issued'` e payload contendo `appointment_id, patient_id, doctor_id, memed_prescription_id`
- [ ] T021 [P] [US3] Contract test em `tests/contract/prescription-records-required-timestamps.spec.ts` — CHECK garante `issued_at NOT NULL` quando `status=issued`; INSERT com `issued_at=NULL` falha

**Checkpoint**: emissão é provadamente capturada, idempotente e auditada. Critério C4/C9 (parte 1) da Memed coberto.

---

## Phase 6: User Story 4 — Evento prescricaoExcluida (Priority: P1) 🎯 Bloqueante para Memed

**Goal**: provar que `prescricaoExcluida` causa transição `issued → deleted` (com `deleted_at`), entrada em `audit_log`, e que `prescription_records` é append-only (DELETE proibido; UPDATE só permite essa transição).

**Independent Test**: rodar `pnpm test -- memed-prescricaoExcluida memed-prescription-records-append-only` — emitir issued → emitir excluida → ver transição. Tentar DELETE → falha. Tentar UPDATE para status arbitrário → falha.

### Tests for User Story 4

- [ ] T022 [US4] Estender `tests/mocks/iframe-stub.html` — função `window.__emitPrescricaoExcluida({ prescriptionId })` que dispara `parent.postMessage({ event: 'prescricaoExcluida', data: {...} })`
- [ ] T023 [P] [US4] Integration test em `tests/integration/memed-prescricaoExcluida.spec.ts` — (a) registro existente `issued` → emitir excluida → assert transição para `deleted` com `deleted_at`; (b) excluida para `prescriptionId` inexistente → registra warn log, não quebra; (c) re-emitir excluida em registro já `deleted` → idempotência
- [ ] T024 [P] [US4] Contract test em `tests/contract/memed-prescription-records-append-only.spec.ts` — `DELETE FROM prescription_records WHERE id=X` falha sempre (trigger bloqueia); `UPDATE status='deleted' WHERE status='issued'` permitido; `UPDATE status='issued' WHERE status='deleted'` (rollback) falha; `UPDATE` em qualquer outro campo (pdf_url, etc.) falha
- [ ] T025 [P] [US4] Estender `tests/contract/memed-audit-events.spec.ts` (parte deleted) — UPDATE `issued→deleted` cria linha em `audit_log` com `event_type='prescription.deleted'`

**Checkpoint**: exclusão é provadamente capturada, refletida no banco como append-only, auditada. Critério C5/C9 (parte 2) da Memed coberto.

---

## Phase 7: User Story 5 — Credenciais Nunca Expostas no Front (Priority: P1) 🎯 Bloqueante para Memed

**Goal**: provar em 3 camadas (lint, build scan, E2E) que `api_key`/`secret_key` da Memed nunca aparecem em código de front, bundle JS, ou tráfego HTTP recebido pelo navegador.

**Independent Test**: rodar `pnpm lint && pnpm build && pnpm scan:memed-keys && pnpm e2e:memed -- memed-credential-leak-scan` — todos verdes.

### Tests for User Story 5

- [ ] T026 [US5] Implementar lógica completa da regra ESLint em `tools/eslint-rules/no-memed-secrets-in-frontend.js` — detecta `MemberExpression` em `process.env.MEMED_*` em arquivos sob `src/app/**` e `src/components/**`; detecta string literais `MEMED_API_KEY`, `MEMED_SECRET_KEY` (case-insensitive); emite erro com fix sugerido ("mover para backend/route handler")
- [ ] T027 [US5] Implementar lógica completa de `tools/scripts/scan-bundle-for-memed-keys.ts` — varredura recursiva `.next/static/`, 4 patterns regex (`mk_[A-Za-z0-9]{20,}`, `MEMED[_-]?(API|SECRET)[_-]?KEY`, `process\.env\.MEMED`, custom via env), output mascarado, exit 1 se ≥ 1 match; paralelizado com worker_threads (4 workers default); skip `.map` e arquivos > 50MB
- [ ] T028 [P] [US5] Contract test em `tests/contract/memed-credentials-encrypted-at-rest.spec.ts` — INSERT credencial via `enc_text_with_key`; SELECT direto retorna bytes não-printáveis (ciphertext) ≠ valor original; `dec_text_with_key` com chave correta retorna plaintext
- [ ] T029 [P] [US5] Contract test em `tests/contract/memed-pino-redact.spec.ts` — invocar logger.info({ config: { api_key: 'mk_secret123' } }, 'msg'); capturar stdout JSON; assert que `api_key` aparece como `***REDACTED***`
- [ ] T030 [P] [US5] Integration test em `tests/integration/memed-token-no-secret-leak.spec.ts` — chamar endpoint `/api/medicos/[id]/memed-token` em ambiente de teste; varrer toda response (body + headers); assert 0 ocorrências de string `api_key` ou `secret_key` (case-insensitive)
- [ ] T031 [P] [US5] Integration test em `tests/integration/memed-error-messages-no-credentials.spec.ts` — forçar erro upstream do mock (Memed mock retorna 500); endpoint do Clinni retorna 502/503 com mensagem genérica; assert mensagem não contém `mk_`, `MEMED_`, ou substring das credenciais cifradas
- [ ] T032 [US5] E2E test em `tests/e2e/memed-credential-leak-scan.spec.ts` — Playwright: navegar fluxo completo (login → atendimento → prescrever → emitir → fechar); `page.on('response', ...)` agrega bodies; `page.on('request', ...)` agrega URLs e headers; ao final scan textual case-insensitive por `api_key`, `secret_key`, `mk_[a-z0-9]{20,}` em todos os bodies/URLs/headers — assert 0 matches
- [ ] T032a [P] [US5] E2E test em `tests/e2e/memed-prescribe-button-to-iframe-loaded.spec.ts` — cobre SC-008: medir tempo entre clique no botão "Prescrever" e momento em que o iframe está totalmente carregado com paciente correto (event `core:moduleInit` após `setPaciente`); rodar 20 iterações em loop, agregar e assertar `p95 ≤ 3000ms`. Saída do teste imprime min/p50/p95/p99 para tracking.

**Checkpoint**: 3 camadas independentes provam que credenciais nunca alcançam o front + tempo de abertura da prescrição cumpre SC-008. Critério C7 (revogação item 2) da Memed coberto.

---

## Phase 8: User Story 6 — setFeatureToggle Respeitado (Priority: P2)

**Goal**: provar que toggles desativados pela Memed no iframe não são sobrescritos pelo wrapper Clinni (sem CSS forçando display, sem props que reativem features).

**Independent Test**: rodar `pnpm e2e:memed -- memed-feature-toggle-respected` — mock dispara toggle off para feature X; assert X permanece oculto na UI externa também.

### Tests for User Story 6

- [ ] T033 [US6] Estender `tests/mocks/iframe-stub.html` — função `window.__emitFeatureToggle({ feature, enabled })` que dispara `parent.postMessage({ command: 'setFeatureToggle', feature, enabled })`
- [ ] T034 [US6] E2E test em `tests/e2e/memed-feature-toggle-respected.spec.ts` — Playwright: carregar iframe stub no contexto do dashboard; emitir `setFeatureToggle('manualPrescription', false)`; assert que elementos externos com `data-feature="manualPrescription"` ficam ocultos OU não existem; inspecionar CSS computado de elementos do iframe — nenhuma regra externa sobrepõe `display`, `visibility`, `pointer-events`

**Checkpoint**: respeito a toggles é provadamente garantido. Critério C8 (revogação item 3) da Memed coberto.

---

## Phase 9: User Story 7 — Aceite Institucional (Priority: P3)

**Goal**: documentar formalmente o aceite humano dos 9 itens da Memed no portal deles, com registro versionado e auditável.

**Independent Test**: rodar `pnpm verify:memed-acceptance` — script confirma existência e completude do registro.

### Tests for User Story 7

- [ ] T035 [US7] Criar template em `docs/legal/memed-acceptance-record.md` — seções: identificação do responsável (nome + e-mail + cargo), data do aceite, lista dos 9 itens com checkbox `[ ]` (a ser marcado quando aceite real é feito), referência cruzada para evidência técnica (link para teste ou FR que prova), versão do produto na data
- [ ] T036 [US7] Implementar lógica de `tools/scripts/verify-memed-acceptance.ts` — abrir `docs/legal/memed-acceptance-record.md`, parsear, validar (a) presença de `data:` ISO 8601 não vazia; (b) presença de `responsável:` não vazio; (c) 9 itens com `[x]` marcado; (d) cada item tem referência para evidência; exit 0 se OK, exit 1 com mensagem específica do que falta

**Checkpoint**: aceite institucional documentado e auditável. Critério C1 da Memed coberto.

---

## Phase 10: Polish & Cross-Cutting Concerns

**Purpose**: testes transversais de constituição (isolamento + RBAC) + CI workflow + smoke E2E + validação final do quickstart.

- [ ] T037 [P] Contract test transversal em `tests/contract/memed-conformity-tenant-isolation.spec.ts` — Constituição III: criar fixture em tenant A (config + prescriber + record); como cliente do tenant B (JWT trocado) tentar SELECT cada uma das 3 tabelas — assert 0 linhas retornadas em todas; tentar INSERT cross-tenant — assert falha
- [ ] T038 [P] Contract test transversal em `tests/contract/memed-rbac.spec.ts` — Constituição V: matriz 4 papéis (`admin`, `financeiro`, `recepcionista`, `profissional_saude`) × 5 endpoints (`POST /api/integracoes/memed`, `DELETE /api/integracoes/memed`, `POST /api/medicos/[id]/memed-prescritor`, `GET /api/medicos/[id]/memed-token`, `POST /api/atendimentos/[id]/prescricoes`) — assert 200/201 para roles permitidos e 403 para os demais conforme spec 026
- [ ] T039 [P] E2E smoke em `tests/e2e/memed-full-flow.spec.ts` — Playwright: login admin → conectar Memed (mock) → habilitar prescritor → trocar pra profissional → abrir atendimento → prescrever → emitir → fechar → ver indicador no prontuário; ≤ 30s no p95
- [ ] T040 [P] CI workflow em `.github/workflows/memed-conformidade.yml` — trigger paths-filter (arquivos do spec 026 + tools/eslint-rules + tools/scripts + tests/{contract,integration,e2e}/memed-\*); 4 jobs paralelos (lint, unit/contract/integration, build+scan, e2e); cada um falha → bloqueio de merge; tempo alvo ≤ 4min
- [ ] T041 [P] Atualizar `CLAUDE.md` ou criar `docs/memed-conformidade.md` — link para `specs/027-memed-conformidade/quickstart.md` + breve guia "como rodar a suíte localmente quando ajustar feature 026"
- [ ] T042 Executar `pnpm test:memed-conformidade` end-to-end localmente — confirmar tempo ≤ 4 min e que todos os 42 testes verdes; documentar tempo medido em comentário no PR

**Checkpoint**: suíte completa rodando verde em CI; bloqueio de merge ativo em regressão; documentação atualizada.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: sem dependências — pode começar imediatamente
- **Foundational (Phase 2)**: depende de Phase 1 completa — BLOQUEIA todas as user stories
- **User Stories (Phases 3-9)**: dependem de Phase 2 completa
  - US1 e US2 podem rodar em paralelo (toques diferentes: prescritor vs paciente)
  - US3 e US4 podem rodar em paralelo (eventos diferentes), mas T020 e T025 ambos tocam `memed-audit-events.spec.ts` — ordenar US3 antes de US4 para evitar conflito de arquivo
  - US5 é independente das demais (foco em tooling/scan)
  - US6 depende de Phase 2 (iframe stub)
  - US7 é doc-only, sem dependência de outra US
- **Polish (Phase 10)**: depende de pelo menos US1-US5 completas (CI workflow precisa de testes existindo); T039/T040/T041 podem rodar antes se feature 026 estiver maduro suficiente

### Within Each User Story

- Setup do mock para a story (T012, T016, T018, T022, T033) PRIMEIRO porque os testes dependem dele
- Testes [P] dentro da mesma story podem rodar em paralelo (arquivos diferentes)

### Parallel Opportunities

- **Phase 1**: T002, T003, T005 paralelos
- **Phase 2**: T008, T009, T010 paralelos (skeletons independentes)
- **Phase 3**: T013, T014, T015 paralelos depois de T012
- **Phase 5**: T019, T020, T021 paralelos depois de T018
- **Phase 6**: T023, T024, T025 paralelos depois de T022
- **Phase 7**: T028, T029, T030, T031 paralelos depois de T026 e T027 (lint + scan implementados); T032 (E2E) depois de Phase 2 estar OK
- **Phase 10**: T037, T038, T039, T040, T041 paralelos

### MVP Recommendation

A "MVP" desta spec = US1 + US2 + US3 + US4 + US5 (todos P1). Sem qualquer um destes, a Memed nega produção. US6 (P2) e US7 (P3) podem entrar logo em seguida mas não bloqueiam o pedido inicial de avaliação.

---

## Parallel Example: User Story 5 (após T026 e T027)

```bash
# Estes 4 testes podem rodar simultaneamente:
Task: "Contract test em tests/contract/memed-credentials-encrypted-at-rest.spec.ts"
Task: "Contract test em tests/contract/memed-pino-redact.spec.ts"
Task: "Integration test em tests/integration/memed-token-no-secret-leak.spec.ts"
Task: "Integration test em tests/integration/memed-error-messages-no-credentials.spec.ts"
```

---

## Implementation Strategy

### MVP First (US1 → US2 → US3 → US4 → US5)

1. Completar Phase 1 (Setup) + Phase 2 (Foundational): mock + skeletons prontos
2. Phase 3 (US1) + Phase 4 (US2): provar cadastro completo de prescritor e paciente
3. Phase 5 (US3) + Phase 6 (US4): provar eventos
4. Phase 7 (US5): provar credenciais protegidas em 3 camadas
5. **STOP e VALIDATE**: rodar `pnpm test:memed-conformidade` — todos os P1 verdes = MVP pronto para submeter avaliação Memed
6. Submeter à Memed pelo portal

### Incremental Delivery (depois do MVP)

7. Phase 8 (US6) + Phase 9 (US7) — incrementos que cobrem critério de revogação e formalidade
8. Phase 10 (Polish): CI workflow + smoke E2E + tenant isolation + RBAC + docs

### Parallel Team Strategy (2 devs em paralelo)

Depois de Phase 2 estar OK:

- Dev A: Phases 3, 5, 7 (Prescritor + prescricaoImpressa + Credenciais)
- Dev B: Phases 4, 6, 8 (Paciente + prescricaoExcluida + FeatureToggle)
- Dev A ou B: Phase 9 (doc) + Phase 10 (cross-cutting)

---

## Notes

- Esta spec **não cria features no produto**. Cada task entrega teste/script/doc que valida algo que a feature 026 (em curso) deve fazer.
- Se um teste em US1-US7 falhar porque a feature 026 ainda não entregou a funcionalidade alvo: o teste fica **pending/skip** com TODO referenciando a fase do spec 026 que precisa completar primeiro. Não delete o teste — mantenha como prova de que vamos testar quando 026 entregar.
- Commits após cada task ou grupo lógico facilita revisão (cada US é ~5 tasks = ~5 commits).
- Stopar em qualquer checkpoint é seguro — cada US é independente.
- Evitar: tasks vagas, conflito de arquivo entre tasks paralelas (re-cheque T020/T025 que ambos tocam `memed-audit-events.spec.ts` — ordenar sequencialmente nesse arquivo).
- A suíte é parte do CI permanente: regressão pós-produção também quebra o build, não só pré-produção.
