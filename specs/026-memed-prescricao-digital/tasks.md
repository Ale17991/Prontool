---
description: 'Task list — Integração Memed (Prescrição Digital)'
---

# Tasks: Integração Memed — Prescrição Digital

**Input**: `specs/026-memed-prescricao-digital/` (spec.md, plan.md, research.md, data-model.md, contracts/)
**Tests**: incluídos — a constituição exige testes de contrato (isolamento multi-tenant, RBAC por endpoint, append-only) para features que tocam multi-tenant/RBAC.
**Ordem das fases (decidida)**: Setup → Fundação → **US2 (habilitar prescritor)** → **US1 (prescrever)** → US3 (auditoria) → US4 (especialidade) → US5 (produção) → Polish.

Labels de história mapeiam o spec.md: US1=prescrever no atendimento, US2=habilitar prescritor, US3=auditoria de emissão/exclusão, US4=de-para de especialidade, US5=homologação→produção.

## Format: `[ID] [P?] [Story?] Descrição com caminho`

---

## Phase 1: Setup (infra compartilhada da cápsula)

- [ ] T001 [P] Criar diretório `src/lib/core/integrations/memed/` e `src/lib/core/integrations/memed/types.ts` com schemas Zod (config, credenciais `{api_key, secret_key}`, `environment`, payloads de prescritor) e o tipo `MemedEnvironment`.
- [ ] T002 [P] Criar `src/lib/core/integrations/memed/mask-pii.ts` (mascarar CPF/token/chaves para logs) reaproveitando o padrão de `src/lib/core/integrations/ghl/` quando aplicável.

---

## Phase 2: Foundational (bloqueante — antes de qualquer história)

**⚠️ Nenhuma história começa antes desta fase.**

- [ ] T003 Criar migration `supabase/migrations/0108_memed_prescription.sql` com as 3 tabelas (`tenant_memed_config`, `memed_prescribers`, `prescription_records`) conforme `data-model.md`: PK UUID, `tenant_id`, colunas e CHECKs.
- [ ] T004 Na mesma migration, habilitar RLS e policies por tabela: SELECT por `jwt_tenant_id()`; write admin-only em `tenant_memed_config`/`memed_prescribers`; `prescription_records` SELECT por tenant e INSERT/UPDATE `jwt_role() IN ('admin','profissional_saude')`.
- [ ] T005 Na mesma migration, criar triggers de imutabilidade em `prescription_records` (anti-`DELETE`; anti-`UPDATE` exceto transição `issued→deleted` com `deleted_at`), no padrão de `appointment_completions` (0092).
- [ ] T006 Na mesma migration, acrescentar as 3 tabelas a `test_truncate_all_mutable()` (definida em 0040) para slate limpo nos testes.
- [ ] T007 Aplicar a migration e regenerar tipos: `pnpm supabase:reset && pnpm supabase:gen-types` (substitui o patch manual de `src/lib/db/generated/types.ts`).
- [ ] T008 Implementar `src/lib/core/integrations/memed/credentials.ts` — ler `tenant_memed_config` (escopo de tenant) e decifrar `api_key`/`secret_key` via `dec_text_with_key`; helper `encryptMemedCredentials` via `enc_text_with_key`.
- [ ] T009 Implementar `src/lib/core/integrations/memed/client.ts` — `fetch` JSON:API (`Accept: application/vnd.api+json`), chaves na query, `AbortSignal.timeout(5000)`, resolver `environment`→baseURL (staging/produção), mapa de erros (`ValidationError`/`UpstreamError`) com PII mascarada. **Único lugar que chama a Memed.**
- [ ] T010 [P] Teste de contrato de **isolamento multi-tenant** das 3 tabelas em `tests/contract/memed-tenant-isolation.spec.ts` (acesso cross-tenant deve falhar).
- [ ] T011 [P] Teste de contrato de **append-only** de `prescription_records` em `tests/contract/prescription-records-append-only.spec.ts` (UPDATE indevido/DELETE devem falhar; `issued→deleted` permitido).

**Checkpoint**: schema + cápsula base prontos; testes de DB passando.

---

## Phase 3: US2 — Habilitar profissional como prescritor (P1) 🎯 pré-requisito do MVP

**Goal**: admin conecta a conta Memed da clínica e habilita um profissional como prescritor (com validação dos campos obrigatórios).
**Independent Test**: conectar conta de homologação; habilitar um profissional com dados completos (vira `registered`); um sem CPF é bloqueado com mensagem clara.

- [ ] T012 [US2] Implementar `src/lib/core/integrations/memed/register-prescriber.ts` — montar payload (external_id=doctor.id, nome/sobrenome derivados de full_name, cpf, board{code,number,state}, data_nascimento), chamar `POST/GET /usuarios` via client, upsert em `memed_prescribers` (status `registered`/`error`).
- [ ] T013 [US2] Core de conexão: `src/lib/core/integrations/memed/connect.ts` (upsert `tenant_memed_config` staging + `disconnect`) + `log_audit_event` (`memed.connect`/`memed.disconnect`).
- [ ] T014 [US2] Route Handler `src/app/api/integracoes/memed/route.ts` — `POST` conectar / `DELETE` desconectar, `requireRole(['admin'])`, Zod, nunca retornar chaves.
- [ ] T015 [US2] Route Handler `src/app/api/medicos/[id]/memed-prescritor/route.ts` — `POST` habilitar, `requireRole(['admin'])`; valida conexão + campos do doctor; 400 apontando edição do profissional quando faltar dado.
- [ ] T016 [P] [US2] Página de conexão `src/app/(dashboard)/configuracoes/integracoes/memed/page.tsx` + `memed-connection-form.tsx` (admin) — conectar/desconectar (homologação).
- [ ] T017 [P] [US2] Botão "Habilitar como prescritor" na página do profissional `src/app/(dashboard)/configuracoes/profissionais/[id]/` (mostra status `pending/registered/error`; reusa indicador de dados incompletos do `edit-prescriber-fields.tsx`).
- [ ] T018 [P] [US2] Teste de contrato **RBAC** dos endpoints connect/disconnect/memed-prescritor em `tests/contract/memed-rbac.spec.ts` (cada papel × cada endpoint, conforme matriz em contracts/).
- [ ] T019 [US2] Teste de integração `tests/integration/memed-connect-and-enable-prescriber.spec.ts` (conectar + habilitar feliz + bloqueio por campo faltante).

**Checkpoint**: clínica conectada e profissional apto a prescrever.

---

## Phase 4: US1 — Prescrever no atendimento (P1) 🎯 MVP

**Goal**: profissional abre "Prescrever" no atendimento, paciente pré-carregado, emite a prescrição.
**Independent Test**: com prescritor apto e paciente completo, abrir prescrição com paciente carregado e emitir em homologação.

- [ ] T020 [US1] Implementar `src/lib/core/integrations/memed/get-prescriber-token.ts` — `GET /usuarios/{external_id}` via client, retornar **apenas** `attributes.token`.
- [ ] T021 [US1] Route Handler `src/app/api/medicos/[id]/memed-token/route.ts` — `GET`, `requireRole(['admin','profissional_saude'])` self-scoped; 409 se não registrado, 424 se não conectado; resposta `{ token }` (sem chaves).
- [ ] T022 [US1] Route Handler `src/app/api/atendimentos/[id]/memed-paciente/route.ts` — `GET`, lê paciente via RPC `get_patient_for_tenant` (decifra), mapeia `sex`→M/F, monta payload do `setPaciente`; 422 listando campos faltantes.
- [ ] T023 [US1] Client component `src/app/(dashboard)/.../atendimentos/prescrever-launcher.tsx` — carregar script Memed (`data-token`), aguardar `core:moduleInit`, `setPaciente`, `MdHub.module.show('plataforma.prescricao')`, `logout` ao desmontar/trocar prescritor.
- [ ] T024 [US1] Inserir o botão "Prescrever" no ponto de entrada do atendimento/prontuário (somente prescritor apto), montando `prescrever-launcher`.
- [ ] T025 [P] [US1] Teste de contrato RBAC de `memed-token` e `memed-paciente` em `tests/contract/memed-rbac.spec.ts` (estender matriz).
- [ ] T026 [US1] Teste de integração `tests/integration/memed-token-proxy-no-secret-leak.spec.ts` (proxy devolve token; nenhuma chave em resposta/headers/log).

**Checkpoint**: emissão de prescrição funcional em homologação (MVP).

---

## Phase 5: US3 — Auditoria de emissão e exclusão (P2)

**Goal**: registrar e auditar prescrições emitidas/excluídas, vinculadas a atendimento/paciente/profissional.
**Independent Test**: emitir → `prescription_records` `issued` + audit; excluir → `deleted`/`deleted_at` + audit.

- [ ] T027 [US3] Implementar `src/lib/core/integrations/memed/record-prescription.ts` — inserir emissão (idempotente por `(tenant, memed_prescription_id)`) e transição de exclusão; `log_audit_event` (`prescription.issued`/`prescription.deleted`).
- [ ] T028 [US3] Route Handler `src/app/api/atendimentos/[id]/prescricoes/route.ts` — `POST` registrar emissão, `requireRole(['admin','profissional_saude'])`.
- [ ] T029 [US3] Route Handler `src/app/api/atendimentos/[id]/prescricoes/[memedId]/route.ts` — `PATCH` registrar exclusão (`issued→deleted`).
- [ ] T030 [US3] Ligar os eventos no `prescrever-launcher.tsx`: `prescricaoImpressa`→`POST`, `prescricaoExcluida`→`PATCH`.
- [ ] T031 [P] [US3] Indicador no atendimento/prontuário de que houve prescrição(ões) (leitura de `prescription_records`).
- [ ] T032 [US3] Teste de integração `tests/integration/memed-record-issued-and-deleted.spec.ts` (emissão + exclusão geram registro e audit; idempotência).

**Checkpoint**: rastreabilidade completa de prescrições.

---

## Phase 6: US4 — De-para de especialidade (P2)

**Goal**: associar a especialidade (texto livre) do profissional ao ID do catálogo Memed.
**Independent Test**: selecionar especialidade do catálogo ao habilitar; registro do prescritor passa a usar o ID; sem correspondência registra sem especialidade.

- [ ] T033 [US4] Implementar `src/lib/core/integrations/memed/list-specialties.ts` — proxy de leitura do catálogo de especialidades.
- [ ] T034 [US4] Route Handler `src/app/api/integracoes/memed/especialidades/route.ts` — `GET`, `requireRole(['admin'])`, retorna `[{id,nome}]`.
- [ ] T035 [US4] Seletor de especialidade na UI de habilitar prescritor (T017); persistir `memed_specialty_id` em `memed_prescribers`.
- [ ] T036 [US4] Enviar `especialidade` no payload de `register-prescriber.ts` quando mapeada; permitir sem mapeamento (sinaliza pendência, não bloqueia).

**Checkpoint**: receita com especialidade correta quando disponível.

---

## Phase 7: US5 — Homologação → produção + conformidade (P3)

**Goal**: alternar ambiente por clínica e atender os 5 requisitos de produção.
**Independent Test**: validar fluxo em homologação; alternar para produção (com termo aceito) sem qualquer chave no frontend.

- [ ] T037 [US5] Toggle de `environment` (staging/production) na UI/endpoint de conexão; produção exige termo aceito.
- [ ] T038 [US5] Route Handler `src/app/api/integracoes/memed/termo/route.ts` — `POST` registrar `terms_accepted_at/by` (`requireRole(['admin'])`).
- [ ] T039 [US5] Garantir resolução de baseURL de produção no `client.ts` e gating: bloquear emissão em produção sem termo.
- [ ] T040 [US5] Documentar checklist dos 5 requisitos em `specs/026-memed-prescricao-digital/quickstart.md` (já iniciado) e validar.

**Checkpoint**: pronto para solicitar credenciais de produção à Memed.

---

## Phase 8: Polish & Cross-Cutting

- [ ] T041 [P] Rodar `pnpm typecheck && pnpm lint:auth` e corrigir (garantir que nenhum adapter/rota lê `process.env` de provider fora da cápsula).
- [ ] T042 Rodar `pnpm test:contract && pnpm test:integration` e estabilizar.
- [ ] T043 [P] Atualizar memória do projeto (`project_memed_integration.md`) com o estado final e revisar mascaramento de PII nos logs.
- [ ] T044 Validar `quickstart.md` ponta a ponta em homologação.

---

## Dependencies & Execution Order

- **Setup (P1)** → **Fundação (P2, bloqueante)** → histórias.
- Ordem das histórias (decidida): **US2 → US1 → US3 → US4 → US5**. US1 depende de US2 (precisa de prescritor apto + conexão). US3 depende do launcher de US1. US4 estende a UI de US2. US5 estende a conexão.
- **Polish** ao final.

### Paralelizável

- T001/T002 (setup) em paralelo.
- T010/T011 (contrato DB) em paralelo após a migration.
- Dentro de US2: T016/T017/T018 em paralelo (arquivos distintos).
- Testes marcados [P] de cada história em paralelo.

## Implementation Strategy

- **MVP** = Setup + Fundação + US2 + US1 (conectar, habilitar prescritor, emitir prescrição em homologação). Parar e validar.
- Incremental: US3 (auditoria) → US4 (especialidade) → US5 (produção).
- Tudo construível/validável em **homologação** (chaves públicas) antes da aprovação de produção.

## Notes

- [P] = arquivos diferentes, sem dependência.
- Cápsula `memed/` é o **único** lugar que decifra credenciais e chama a Memed; rotas nunca chamam a Memed direto.
- Token sempre buscado fresco via proxy; chaves nunca no frontend/logs.
- Sem novas deps de runtime (`fetch` + `AbortSignal.timeout`).
