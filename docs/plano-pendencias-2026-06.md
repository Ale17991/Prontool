# Plano de Pendências — Clinni

> Consolidação de tudo que está **pendente ou pela metade** em 2026-06-09, com
> sequência de execução. Não é uma feature nova: é o backlog transversal que
> destrava o que já foi construído e fecha a única feature incompleta (TISS 029).
>
> **Ordem de execução:** Fase 0 → Fase 1 → Fase 2 → Fase 3.
> **Critério da ordem:** colocar no ar o que já está pronto (horas de trabalho)
> antes de construir coisa nova (semanas); começar a submissão Memed cedo porque
> depende de terceiros.

Legenda: `[ ]` pendente · `[X]` concluído · `[~]` em andamento · `[P]` paralelizável

---

## Fase 0 — Higiene do repositório (minutos, risco zero)

Limpa o ruído para enxergar o que importa.

- [x] **P0-01** Bug do calendário **já estava corrigido na master** (`calendar-filters.ts` já usa `startOfDay/endOfDay` no `case 'dia'`). A branch `fix/calendar-day-view-empty` era redundante → **deletada**.
- [x] **P0-02** Docs soltos commitados (`memed-submissao-producao.md`, `pr-030-portal-paciente.md` + este plano).
- [x] **P0-03** [P] `.gitignore` atualizado para ignorar `clinni-instagram/`, `homio-ref/`, `temp-impeccable/`, `tests/e2e/artifacts-memed/`. **Não apagados** (contêm assets de marketing não versionados em outro lugar).
- [x] **P0-04** [P] Branches deletadas: `021-memed-prescricao-digital`, `rebrand/clinni`, `rebrand/favicon`, `rebrand/favicon-round`.
- [x] **P0-05** [P] `stash@{0}` descartado (lockfile + linha de middleware já presente na master via 030).

**Checkpoint:** ✅ working tree limpo; só `029-faturamento-tiss` permanece como branch de trabalho aberta. (Restam ~28 branches de feature locais já mescladas — opcional deletar em lote.)

---

## Fase 1 — Colocar no ar o que já está pronto (alto valor, baixo esforço)

Duas features 100% implementadas, presas apenas por passos operacionais.

### 1a. Memed → produção (026/027/028) — ❌ APROVAÇÃO DISPENSADA

**2026-06-09:** a Memed confirmou que **não é necessária aprovação/validação técnica**
para uso em produção. A submissão do dossiê fica cancelada. O dossiê
(`docs/legal/memed-submissao-producao.md`) permanece como registro de conformidade.

- [~] **P1-01** ~~Enviar dossiê à Memed~~ — **dispensado pela Memed (2026-06-09)**.
- [ ] **P1-02** Confirmar env vars de produção provisionadas na Vercel + migrations 0110 + 0111 aplicadas em produção. _(ação do usuário)_
- [ ] **P1-03** Validar o fluxo em produção quando uma clínica ativar (registrar prescritor → carregar paciente → emitir → capturar eventos). _(ação do usuário)_

### 1b. Portal do paciente (030) → produção — 38/38 tasks ✓

- [ ] **P1-04** Setar `PATIENT_SESSION_SECRET` nas env vars de produção da Vercel.
- [ ] **P1-05** Por clínica: definir o slug público em `tenant_clinic_profile.public_booking_slug`.
- [ ] **P1-06** Operacional: garantir pacientes com CPF + data de nascimento preenchidos; orientar a equipe a registrar as métricas metabólicas no prontuário; divulgar o link `/paciente/[slug]`.
- [x] **P1-07** Migration 0113 aplicada em produção.

**Checkpoint:** Memed em análise pela Memed; Portal acessível por pacientes reais.

---

## Fase 2 — Fechar o MVP da TISS (029-faturamento-tiss)

Única feature de produto genuinamente pela metade. Branch `029-faturamento-tiss`,
migration 0112 ainda não na master. **Setup + Foundational + US1 (T001–T023) já concluídos.**
Ordem obrigatória pelas dependências: **US2 → T034 → US4 → validar**.

### US2 — Gerar e validar Guia de Consulta (T024–T033)

- [ ] **P2-01** [P] Integration test `tiss-generate-consulta.spec.ts` — atendimento completo gera guia `pronta`; XML valida no XSD. (T024)
- [ ] **P2-02** [P] Integration test `tiss-validate-blocks-incomplete.spec.ts` — sem carteira/CBO → `rascunho` + `validation_errors`. (T025)
- [ ] **P2-03** [P] `src/lib/core/tiss/patient-cards.ts` — CRUD de `patient_health_plan_cards` (carteira cifrada por paciente×operadora). (T026)
- [ ] **P2-04** [P] `src/lib/core/tiss/build-guia.ts` — modelo normalizado a partir de `appointments_effective` + procedures + doctors + patients (decifra) + carteira + config; congela `frozen_amount_cents` e `tuss_catalog_version_id`. (T027)
- [ ] **P2-05** `src/lib/core/tiss/validate-content.ts` — regras de obrigatoriedade da Guia de Consulta (Tabela 87+Código, CBO 24, UF 59, Tipo Consulta 52, Indicação Acidente 36, CNES, PF/PJ, TUSS vigente). (T028, dep. P2-04)
- [ ] **P2-06** `src/lib/core/tiss/xml/render-consulta.ts` — modelo → XML `guiaConsulta` com `xmlbuilder2` na ordem do XSD. (T029, dep. P2-04)
- [ ] **P2-07** Persistência: gravar `tiss_guias` + `tiss_guia_procedures` (`rascunho`/`pronta`) + audit. (T030, dep. P2-05)
- [ ] **P2-08** Route `api/tiss/guias/route.ts` (POST) + `guias/[id]/route.ts` (GET+revalida, PATCH status) com `requireRole(['admin','financeiro'])`. (T031, dep. P2-06/07)
- [ ] **P2-09** [P] UI: botão "Gerar guia TISS" no atendimento + lista de pendências. (T032)
- [ ] **P2-10** [P] UI: captura de carteira do beneficiário e CBO do médico. (T033)

### T034 — Pré-requisito de conformidade (BLOQUEANTE para US4)

- [ ] **P2-11** Ler o Componente de Comunicação/Segurança ANS **202511** e fixar em `contracts/tiss-xml-contract.md`: (a) regra exata de concatenação do hash MD-5 do epílogo; (b) formato de assinatura (algoritmo digest/canonicalização, por guia ou por mensagem, conteúdo do `KeyInfo`). **Não pular.** (T034)

### US4 — Lote, assinatura e exportação do XML (T035–T042)

- [ ] **P2-12** [P] Integration test `tiss-lote-and-sign.spec.ts` — lote de 3 guias gera XML que valida no XSD, com hash e assinatura verificável; re-download reproduz conteúdo/hash. (T035)
- [ ] **P2-13** [P] Integration test `tiss-lote-rules.spec.ts` — operadoras mistas → 409; guia não-`pronta` bloqueada; sem certificado ativo → erro claro. (T036)
- [ ] **P2-14** [P] `src/lib/core/tiss/xml/hash.ts` — hash MD-5 conforme P2-11. (T037)
- [ ] **P2-15** `src/lib/core/tiss/xml/render-lote.ts` — `mensagemTISS` (cabeçalho + `loteGuias` + epílogo/hash). (T038, dep. P2-14/P2-06)
- [ ] **P2-16** `src/lib/core/tiss/signing/sign-lote.ts` — `xml-crypto` XMLDSig enveloped RSA-SHA256 com cert A1. (T039, dep. P2-15)
- [ ] **P2-17** Persistência do lote `tiss_lotes` + vincular guias (`lote_id`, status `exportada`), validar XSD antes de fechar, audit. (T040, dep. P2-15/16)
- [ ] **P2-18** Route `api/tiss/lotes/route.ts` (POST criar/fechar) + `lotes/[id]/xml/route.ts` (GET download XML) com `requireRole(['admin','financeiro'])`. (T041, dep. P2-17)
- [ ] **P2-19** [P] UI `financeiro/tiss/page.tsx` + `guias-table.tsx` + `lote-detail.tsx` — selecionar guias, fechar lote, baixar XML, status. (T042)

### Validação do MVP

- [ ] **P2-20** **STOP e validar ponta a ponta:** configurar operadora → gerar consulta → lotear → assinar → baixar XML que valida no XSD, idealmente contra o Validador TISS público / portal de uma operadora-piloto (Unimed/Bradesco/Amil). (T058)
- [ ] **P2-21** `pnpm typecheck` + `pnpm lint:auth` + suíte completa verdes; teste-âncora XSD verde. (T057)
- [ ] **P2-22** Mesclar `029-faturamento-tiss` na master (migration 0112 entra em produção).

### Incrementos pós-MVP (opcionais, não bloqueiam)

- [ ] **P2-23** US3 — Guia SP/SADT (T043–T047).
- [ ] **P2-24** US5 — Glosas e reapresentação, Tabela 38 (T048–T051).
- [ ] **P2-25** US6 — Integração financeira: conta a receber + repasse (T052–T055).
- [ ] **P2-26** Polish: alerta de divergência de catálogo TUSS + expiração de certificado; doc da arquitetura `tiss/` em CLAUDE.md; revisão de segurança final (T056, T059, T060).

**Checkpoint:** ciclo TISS configurar→gerar→lotear→assinar→exportar em produção.

---

## Fase 3 — Pendências de negócio (paralelo, não bloqueiam dev)

### Rebrand Clinni (decidido 2026-05-26)

- [ ] **P3-01** [P] Registrar o domínio `clinnipro` e configurar Resend para os e-mails.
- [ ] **P3-02** [P] Registro de marca no INPI: "Clinni".
- [ ] **P3-03** [P] Atualizar app do GHL Marketplace e aliases para a marca Clinni.

### Landing page (projeto separado em `C:\clinnipro-landing`)

- [ ] **P3-04** Inserir o número de WhatsApp real no CTA.
- [ ] **P3-05** Deploy na Vercel + configurar DNS de `clinnipro.com.br`.

---

## Resumo da sequência

| Fase | O quê                       | Esforço                | Bloqueia?         |
| ---- | --------------------------- | ---------------------- | ----------------- |
| 0    | Higiene do repo             | minutos                | não               |
| 1a   | Submeter Memed à produção   | horas + espera externa | começar cedo      |
| 1b   | Portal 030 ao ar            | horas                  | não               |
| 2    | MVP TISS (US2 → T034 → US4) | semanas                | T034 bloqueia US4 |
| 3    | Rebrand + landing           | dias, paralelo         | não               |
