---
description: "Task list — Faturamento TISS de Convênios (feature 029)"
---

# Tasks: Faturamento TISS de Convênios

**Input**: Design documents from `/specs/029-faturamento-tiss/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/

**Tests**: INCLUÍDOS — a Constituição (Quality Gates) **obriga** testes de contrato de imutabilidade/append-only, isolamento multi-tenant e RBAC por endpoint para features financeiras/multi-tenant/TUSS. Acrescenta-se o **teste-âncora XML×XSD** (SC-001).

**Organization**: por user story. Ordem de entrega = **MVP primeiro**: Setup → Foundational → US1 → US2 → US4 (estes três = MVP mínimo viável) → US3 → US5 → US6 → Polish.

## Format: `[ID] [P?] [Story] Description`
- **[P]** = paralelizável (arquivos distintos, sem dependência pendente).
- Caminhos absolutos a partir da raiz do repo `C:\My project\`.

---

## Phase 1: Setup (Shared Infrastructure)

- [X] T001 Instalar deps de runtime no `package.json`: `xmlbuilder2`, `xmllint-wasm`, `xml-crypto`, `node-forge` (+ `@types/node-forge` em dev). Rodar `pnpm install`. ✓ (xmlbuilder2 4.0.3, xmllint-wasm 5.2.0, xml-crypto 6.1.2, node-forge 1.4.0)
- [X] T002 [P] Criar a estrutura da cápsula `src/lib/core/tiss/` (subpastas `xml/`, `signing/`, `schemas/04.03.00/`) e `src/lib/core/tiss/version.ts` com as constantes-alvo. ✓ (`src/lib/core/tiss/version.ts`)
- [X] T003 [P] Baixar o `.zip` do Componente de Comunicação **04.03.00** e commitar os `.xsd` em `src/lib/core/tiss/schemas/04.03.00/` + `SOURCE.md`. ✓ (10 XSDs incl. `tissV4_03_00.xsd`, `tissGuiasV4_03_00.xsd`, `tissAssinaturaDigital_v1.01.xsd`, `xmldsig-core-schema.xsd`)

**Checkpoint**: deps instaladas, cápsula esqueleto criada, XSDs versionados no repo.

---

## Phase 2: Foundational (Blocking Prerequisites)

**⚠️ CRITICAL**: nenhuma user story começa antes desta fase.

- [X] T004 Criar migration `supabase/migrations/0112_tiss_faturamento.sql` com as 7 tabelas + `patient_health_plan_cards` + `ALTER doctors ADD cbo`. ✓
- [X] T005 Na mesma migration: RLS por `jwt_tenant_id()`, triggers `enforce_append_only_columns('<whitelist>')` por tabela, trigger de coerência da linha (par `tuss_table`+`procedure_code`; `tuss_codes.valid_to`). ✓ (audit fica na camada de app — padrão da feature 026, não trigger). `test_truncate_all_mutable` não precisa de mudança: tabelas FK→tenants são alcançadas pelo `TRUNCATE ... tenants CASCADE`.
- [X] T006 ✓ `scripts/seed-tiss-domains.ts` (+ `seed:tiss-domains`) — extrai os domínios **dos tipos `dm_*` do XSD oficial** já versionado (fonte autoritativa, sem download de 178MB nem transcrição). **261 entradas em 11 domínios**: 23, 24(CBO), 26, 35, 36, 48, 50, 52, 59(UF), 76, 87. Idempotente (ON CONFLICT DO NOTHING). **Tabela 38 (glosas)** NÃO é enumerada no XSD → fica para US5 (fonte: ANS FHIR CodeSystem-tuss-38). `tiss_domain_tables` não é truncada pelos testes (sem tenant_id) → persiste após reset; CI deve rodar `seed:tiss-domains`.
- [X] T007 ✓ `supabase:reset` aplicou a 0112 (sem erro); `gen-types` regenerou (TISS tables presentes); re-seed `seed:demo` (demo restaurada) + `seed:tuss:22` (5851 códigos, `SEED_TUSS_FORCE=1` em dev). `pnpm typecheck` verde.
- [X] T008 [P] `src/lib/core/tiss/domains.ts` — leitura tipada das tabelas de domínio. ✓
- [X] T009 [P] `src/lib/core/tiss/mask.ts` — masking de PII/segredos para logs. ✓
- [X] T010 `src/lib/core/tiss/validate.ts` — `xmllint-wasm` carrega os XSDs 04.03.00 (resolve include/import) e valida `mensagemTISS`, erros `{message,line}`. ✓ (root detectado por padrão — ANS usa `tissV4_03_00.xsd` sem zero à esquerda)
- [X] T011 [P] Contract test `tests/contract/tiss-tenant-isolation.spec.ts` — tenant B não lê config/lotes do A; insert cross-tenant barrado por RLS. ✓ (3 testes)
- [X] T012 [P] Contract test `tests/contract/tiss-rbac.spec.ts` — RLS: config = admin-only; lotes = admin/financeiro (recepcionista/profissional_saude barrados). ✓ (2 testes). RBAC de endpoint (`requireRole`+audit deny) entra em US1+.
- [X] T013 [P] Contract test `tests/contract/tiss-guias-append-only.spec.ts` — DELETE bloqueado e UPDATE fora da whitelist bloqueado em guias/lotes/procedures/glosas; whitelist (status) permitida. ✓ (6 testes)
- [X] T014 [P] Contract test-âncora `tests/contract/tiss-xml-validates-against-xsd.spec.ts` — pipeline XSD carrega e rejeita XML inválido (2 testes ✓). Caminho positivo entra em US2/US4.

**Checkpoint**: schema aplicado, validação XSD funcional, testes de contrato passando. User stories podem começar.

---

## Phase 3: User Story 1 — Configurar convênio para TISS (Priority: P1) 🎯 MVP

**Goal**: admin habilita TISS num convênio (Registro ANS, versão, código do contratado, CNPJ/CNES, mapeamentos) e sobe o certificado A1.

**Independent Test**: cadastrar config TISS de uma operadora fictícia + certificado A1 de teste; reabrir e confirmar persistência + auditoria; outro tenant não vê.

### Tests for US1 ⚠️
- [X] T015 [P] [US1] Integration test `tiss-operator-config.spec.ts` — habilita TISS + audit; faltando Registro ANS → 422 com campo. ✓ (2 testes)
- [X] T016 [P] [US1] Integration test `tiss-certificate-upload.spec.ts` — `.pfx` self-signed via node-forge; persiste cifrado; resposta não vaza conteúdo/senha; senha errada → 400. ✓ (2 testes)

### Implementation for US1
- [X] T017 [P] [US1] `src/lib/core/tiss/operator-config.ts` — CRUD + Zod (Registro ANS 6díg, CNPJ 14díg, CNES 7díg). ✓ (+ `audit.ts`, `errors.ts`)
- [X] T018 [P] [US1] `src/lib/core/tiss/signing/load-certificate.ts` — node-forge: `readCertificateInfo` (CN+notAfter) + `loadCertificateForSigning` (PEM+chave, p/ US4). ✓
- [X] T019 [US1] `src/lib/core/tiss/certificates.ts` — cifra pfx+senha (`enc_text_with_key`), 1 ativo/tenant, audit, delete. ✓
- [X] T020 [US1] Route `src/app/api/tiss/operadoras/[planId]/route.ts` — POST/DELETE admin; 422 com lista de pendências. ✓
- [X] T021 [US1] Route `src/app/api/tiss/certificados/route.ts` (POST multipart) + `[id]/route.ts` (DELETE), admin. ✓ (lint:auth verde)
- [X] T022 [P] [US1] UI `configuracoes/integracoes/tiss/page.tsx` + `tiss-operator-form.tsx`. ✓
- [X] T023 [P] [US1] UI `tiss-certificate-form.tsx` — upload A1 + senha, CN/validade, alerta de expiração. ✓

**Checkpoint**: ✅ operadora "TISS habilitado" + certificado ativo (4 testes de integração verdes, typecheck+lint+lint:auth verdes).

---

## Phase 4: User Story 2 — Gerar e validar Guia de Consulta (Priority: P1) 🎯 MVP

**Goal**: a partir de um atendimento de consulta, gerar a Guia de Consulta com campos preenchidos e validação clara de pendências.

**Independent Test**: atendimento completo → guia `pronta` com todos os campos; atendimento sem carteira/CBO → guia `rascunho` com pendências listadas campo a campo.

### Tests for US2 ⚠️
- [ ] T024 [P] [US2] Integration test `tests/integration/tiss-generate-consulta.spec.ts` — atendimento completo gera guia `pronta`; XML da guia valida no XSD.
- [ ] T025 [P] [US2] Integration test `tests/integration/tiss-validate-blocks-incomplete.spec.ts` — sem carteira do beneficiário / sem CBO → `rascunho` + `validation_errors` com `{field,message}`; guia não entra em lote.

### Implementation for US2
- [ ] T026 [P] [US2] `src/lib/core/tiss/patient-cards.ts` — CRUD de `patient_health_plan_cards` (carteira por paciente×operadora, cifrada).
- [ ] T027 [P] [US2] `src/lib/core/tiss/build-guia.ts` — montar modelo normalizado da guia a partir de `appointments_effective` + `appointment_procedures` + `doctors` (conselho/UF/CBO) + `patients` (decifra via `get_patient_for_tenant`) + carteira + `tenant_tiss_operator_config`. Congela `frozen_amount_cents` e `tuss_catalog_version_id`.
- [ ] T028 [US2] `src/lib/core/tiss/validate-content.ts` — regras de obrigatoriedade da **Guia de Consulta** (contracts/tiss-xml-contract.md): par Tabela(87)+Código, CBO(24), UF(59), Tipo de Consulta(52), Indicação de Acidente(36), CNES, regra PF/PJ do executante, TUSS vigente; devolve `validation_errors[]`. (depende T027)
- [ ] T029 [US2] `src/lib/core/tiss/xml/render-consulta.ts` — modelo → XML `guiaConsulta` com `xmlbuilder2` (ordem do XSD, escaping). (depende T027)
- [ ] T030 [US2] Persistência da guia: gravar `tiss_guias` + `tiss_guia_procedures` (status `rascunho`/`pronta`), audit. (depende T028)
- [ ] T031 [US2] Route `src/app/api/tiss/guias/route.ts` (POST gerar) + `guias/[id]/route.ts` (GET detalhe+revalida, PATCH status) com `requireRole(['admin','financeiro'])`. (depende T029, T030)
- [ ] T032 [P] [US2] UI: botão "Gerar guia TISS" no atendimento (`operacao/atendimentos/...`) e lista de pendências (espelha o bloqueio da prescrição Memed).
- [ ] T033 [P] [US2] UI captura de carteira do beneficiário (em paciente/atendimento) e CBO do médico (em `doctors`).

**Checkpoint**: Guia de Consulta gerável e validável; pendências claras. (MVP parcial: US1+US2.)

---

## Phase 5: User Story 4 — Lote, assinatura e exportação do XML (Priority: P1) 🎯 MVP

**Goal**: agrupar guias `pronta` de uma operadora em lote, montar XML (cabeçalho+loteGuias+epílogo/hash), validar XSD, **assinar (A1)** e baixar.

**Independent Test**: 3 guias `pronta` da mesma operadora → lote fechado → XML baixa, valida no XSD oficial, tem `numeroLote`, `hash` (MD-5) e `Signature`; guia de outra operadora no mesmo lote é bloqueada.

### Pré-requisito de conformidade (bloqueante para US4)
- [ ] T034 [US4] Ler o **Componente de Comunicação/Segurança e Privacidade 202511** e fixar: (a) a **regra exata de concatenação do hash MD-5** do epílogo; (b) o **formato de assinatura** exigido (algoritmo digest/canonicalização, se por guia ou por mensagem, conteúdo do `KeyInfo`). Registrar em `contracts/tiss-xml-contract.md`.

### Tests for US4 ⚠️
- [ ] T035 [P] [US4] Integration test `tests/integration/tiss-lote-and-sign.spec.ts` — lote de 3 guias gera XML que valida no XSD, com hash e assinatura verificável; re-download reproduz o mesmo conteúdo/hash.
- [ ] T036 [P] [US4] Integration test `tests/integration/tiss-lote-rules.spec.ts` — operadoras mistas → 409; guia não-`pronta` → bloqueio; sem certificado ativo → erro claro.

### Implementation for US4
- [ ] T037 [P] [US4] `src/lib/core/tiss/xml/hash.ts` — hash MD-5 conforme T034 (`crypto.createHash('md5')`).
- [ ] T038 [US4] `src/lib/core/tiss/xml/render-lote.ts` — `mensagemTISS` (cabeçalho + `prestadorParaOperadora/loteGuias` + `epilogo`/hash) agregando guias. (depende T037, T029)
- [ ] T039 [US4] `src/lib/core/tiss/signing/sign-lote.ts` — `xml-crypto` XMLDSig enveloped RSA-SHA256 com cert A1 (via T018), conforme T034. (depende T038, T018)
- [ ] T040 [US4] Persistência do lote: `tiss_lotes` (`lote_number`, `xml_content`, `xml_hash_md5`, `signed_at`, `certificate_id`, status), vincular guias (`lote_id`, status `exportada`), validar XSD antes de fechar, audit. (depende T038, T039, T010)
- [ ] T041 [US4] Route `src/app/api/tiss/lotes/route.ts` (POST criar/fechar) + `lotes/[id]/xml/route.ts` (GET download `application/xml`) com `requireRole(['admin','financeiro'])`. (depende T040)
- [ ] T042 [P] [US4] UI `src/app/(dashboard)/financeiro/tiss/page.tsx` + `guias-table.tsx` + `lote-detail.tsx` — selecionar guias, fechar lote, baixar XML, ver status.

**Checkpoint**: **MVP mínimo viável completo (US1+US2+US4)** — ciclo configurar→gerar consulta→lote→assinar→exportar ponta a ponta.

---

## Phase 6: User Story 3 — Gerar e validar Guia de SP/SADT (Priority: P2)

**Goal**: gerar SP/SADT com blocos solicitante/executante e múltiplas linhas de procedimento + totalizadores.

**Independent Test**: atendimento com 2 procedimentos → SP/SADT com 2 linhas (Tabela 87+Código+Via+Técnica+valores), blocos solicitante/executante; falta de par Tabela+Código bloqueia.

### Tests for US3 ⚠️
- [ ] T043 [P] [US3] Integration test `tests/integration/tiss-generate-spsadt.spec.ts` — 2 procedimentos → 2 linhas; XML valida no XSD; linha sem Tabela+Código → pendência.

### Implementation for US3
- [ ] T044 [US3] Estender `build-guia.ts` para `sp_sadt` (blocos solicitante/executante; Caráter 23, Tipo de Atendimento 50; Grau de Participação 35 por linha quando há honorários). (depende T027)
- [ ] T045 [US3] Estender `validate-content.ts` com as regras da SP/SADT (Técnica dom. 48, Via cirúrgica, totalizadores). (depende T028)
- [ ] T046 [US3] `src/lib/core/tiss/xml/render-spsadt.ts` — modelo → XML `guiaSP-SADT` com `xmlbuilder2`. (depende T044)
- [ ] T047 [US3] Integrar `guia_type='sp_sadt'` na route `guias/route.ts` e na UI de geração. (depende T046)

**Checkpoint**: Consulta e SP/SADT geráveis e loteáveis.

---

## Phase 7: User Story 5 — Status, glosas e reapresentação (Priority: P2)

**Goal**: registrar manualmente glosas (Tabela 38) por guia/procedimento e reapresentar guias glosadas.

**Independent Test**: marcar guia exportada como glosada (motivo Tabela 38 + valor) → status `glosada`; reapresentar gera nova guia `rascunho` com `supersedes_guia_id`; tudo auditado.

### Tests for US5 ⚠️
- [ ] T048 [P] [US5] Integration test `tests/integration/tiss-glosa-and-resubmit.spec.ts` — registrar glosa (valida motivo na Tabela 38) → `glosada`/`parcial`; reapresentação mantém vínculo.

### Implementation for US5
- [ ] T049 [US5] `src/lib/core/tiss/glosa.ts` — registrar glosa em `tiss_glosas` (valida `motivo_code` contra domínio 38), atualizar status da guia, e `reapresentar` (cria guia com `supersedes_guia_id`), audit.
- [ ] T050 [US5] Route `src/app/api/tiss/glosas/route.ts` (POST registrar) + `glosas/reapresentar/route.ts` (POST) com `requireRole(['admin','financeiro'])`. (depende T049)
- [ ] T051 [P] [US5] UI no painel financeiro/tiss: registrar glosa (seletor de motivo Tabela 38 + valor) e botão reapresentar; coluna de status/valor glosado.

**Checkpoint**: ciclo de glosa/reapresentação fechado.

---

## Phase 8: User Story 6 — Integração financeira (conta a receber + repasse) (Priority: P3)

**Goal**: lote exportado vira conta a receber da operadora; conciliação parcial respeita o repasse médico (feature 023).

**Independent Test**: exportar lote de R$ X → conta a receber da operadora no valor apresentado; pagamento parcial (com glosa) → repasse calculado sobre o recebido.

### Tests for US6 ⚠️
- [ ] T052 [P] [US6] Integration test `tests/integration/tiss-financeiro-conta-receber.spec.ts` — lote exportado cria conta a receber; pagamento parcial reflete no repasse conforme 023.

### Implementation for US6
- [ ] T053 [US6] `src/lib/core/tiss/receivables.ts` — ao exportar lote, gerar conta a receber da operadora (integrar com o módulo financeiro existente `accounts-receivable`), valor apresentado.
- [ ] T054 [US6] Conciliação: registrar pagamento (inclusive parcial por glosa) e garantir que o repasse (`monthly_payouts`/`installment_payments`) considera o valor recebido. (depende T053, T049)
- [ ] T055 [P] [US6] UI: vincular status pago/parcial da guia ao financeiro e exibir no painel.

**Checkpoint**: faturamento de convênio conectado ao caixa e ao repasse.

---

## Phase 9: Polish & Cross-Cutting Concerns

- [ ] T056 [P] Alerta operacional de **divergência de catálogo TUSS** e de **expiração de certificado** (Princípio IV + segurança).
- [ ] T057 [P] Rodar `pnpm typecheck`, `pnpm lint:auth` e a suíte completa (`pnpm test`); garantir o teste-âncora XSD verde.
- [ ] T058 [P] Validar `quickstart.md` ponta a ponta contra uma **operadora-piloto grande** (Unimed/Bradesco/Amil): conferir o XML real no Validador TISS público / portal. (decisão D4)
- [ ] T059 [P] Atualizar `CLAUDE.md`/docs com a arquitetura da cápsula `tiss/` e o processo de atualização de versão/XSD a cada release ANS.
- [ ] T060 Revisão de segurança: confirmar que nenhum segredo (cert/senha) ou PII aparece em logs/respostas (grep + teste), e que XSD/versão são reproduzíveis.

---

## Dependencies & Execution Order

- **Setup (P1)** → **Foundational (P2, bloqueia tudo)** → user stories.
- **US1, US2, US4 (P1)** = MVP. US4 depende de US2 (precisa de guias `pronta`) e de US1 (certificado/operadora). Ordem MVP: US1 → US2 → US4.
- **US3 (P2)** depende de `build-guia`/`validate-content` (US2) mas é fatia independente.
- **US5 (P2)** depende de existir guia exportada (US4).
- **US6 (P3)** depende de US4 (export) e US5 (glosa para conciliação parcial).
- Dentro de cada story: testes → core (models/services) → routes → UI.

### Parallel Opportunities
- Setup: T002, T003 em paralelo.
- Foundational: T008, T009 em paralelo; T011–T014 (testes) em paralelo após o schema (T007).
- US1: T017/T018 e UIs T022/T023 em paralelo.
- US2: T026/T027 em paralelo; testes T024/T025 em paralelo.
- Stories diferentes podem ser tocadas por devs distintos após a Foundational.

---

## Implementation Strategy

### MVP First
1. Phase 1 (Setup) → 2. Phase 2 (Foundational) → 3. US1 → 4. US2 → 5. US4 → **STOP e validar** o ciclo ponta a ponta (gerar consulta, lotear, assinar, baixar XML que valida no XSD). Demo.

### Incremental
US3 (SP/SADT) → US5 (glosas) → US6 (financeiro), cada um testável e entregável sem quebrar o anterior.

### Notas
- **Não rodar `vitest` durante teste manual** (apaga o banco local; re-seed `pnpm seed:demo`).
- Produção: migration via `supabase db push` (nunca `db reset --linked`).
- Commit por tarefa ou grupo lógico.
- T034 (regra de hash + formato de assinatura) é **bloqueante** para US4 — não pular.
