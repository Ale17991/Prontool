# Implementation Plan: Conformidade Memed — Checklist Pré-Produção

**Branch**: `027-memed-conformidade` | **Date**: 2026-05-29 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/027-memed-conformidade/spec.md`

## Summary

Esta feature **não entrega funcionalidade nova**; entrega **prova auditável** de que a feature 026 (Memed Prescrição Digital) atende aos 9 critérios que a Memed verifica antes de liberar a chave de produção, e que podem revogá-la depois. O plano organiza:

1. **Suíte de verificação automatizada** que falha no CI sempre que algum critério é quebrado (ex.: chave Memed escapa para o front, evento `prescricaoImpressa` não persiste, prescritor é registrado com campo faltando).
2. **Scripts de auditoria manual** que reproduzem o que a Memed faz na avaliação (scan de credenciais no bundle, captura de eventos no iframe, inspeção de payload do `setPaciente`).
3. **Registro institucional** (documento legal versionado) do aceite dos 9 itens.

O trabalho aqui é majoritariamente em **tests/** e **scripts/**, com poucos arquivos novos em `src/`. As tabelas e endpoints citados nas FRs já são responsabilidade do spec 026.

## Technical Context

**Language/Version**: TypeScript 5.4 sobre Node.js 20 LTS (mesma stack do app)
**Primary Dependencies**:
- Vitest 1.6 (já presente) — runner de testes unit/integration/contract
- `@supabase/supabase-js` 2.45 (já presente) — para asserts contra Supabase local em testes
- Pino 9 (já presente) — para validar que máscara de credencial está aplicada
- ESLint 8 com `eslint-plugin-custom-rules` (a criar) — regra customizada `no-memed-secrets-in-frontend`
- Playwright (a adicionar — ~30MB, dev only) — para testes E2E que inspecionam tráfego do iframe
**Storage**: nenhuma migração nova. Lê apenas: `tenant_memed_config`, `memed_prescribers`, `prescription_records`, `audit_log` — criadas pelo spec 026.
**Testing**:
- Contract tests (Vitest + supabase local)
- Integration tests (Vitest + msw para mock da Memed)
- E2E tests (Playwright apontando para `pnpm dev` rodando localmente)
- Lint custom rule (eslint plugin local em `tools/eslint-rules/`)
**Target Platform**: CI no GitHub Actions (Ubuntu 22.04) + dev local (Windows/Mac)
**Project Type**: web (Next.js 14.2 App Router + Supabase) — verificação adiciona apenas test infra
**Performance Goals**:
- CI da suíte completa de conformidade ≤ 4 min (paralelizada)
- Scan de credencial no bundle ≤ 30 s
- E2E Playwright para os 9 critérios ≤ 90 s
**Constraints**:
- Não introduzir dependência runtime — toda nova dep é `devDependency`
- Não modificar produção sem que o spec 026 esteja entregando o que esta spec audita
- Testes E2E NÃO devem chamar Memed real; usar mock conforme contrato em `contracts/memed-mock.md`
**Scale/Scope**:
- 9 critérios = 9 user stories
- ~15 testes de contrato/integração novos
- ~5 testes E2E
- 1 script de scan de credencial (bash + grep) + 1 lint rule
- 1 documento legal versionado

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

A constituição vigente (`v1.0.0`, ratificada em 2026-04-16) define 5 princípios. Avaliação contra cada um:

- **I. Integridade Financeira Imutável (NON-NEGOTIABLE)** — ✅ **Compatível**. Esta feature não muta dados financeiros; apenas valida. A tabela `prescription_records` (do spec 026) é append-only por trigger (FR-008 desta spec exige); validar essa propriedade é um dos testes da suíte.

- **II. Auditabilidade Total de Preços (NON-NEGOTIABLE)** — ✅ **Compatível**. Não toca em tabelas de preço. Por extensão, esta spec **fortalece** auditabilidade ao exigir entrada `log_audit_event` para `prescription.issued`/`prescription.deleted` (FR-009).

- **III. Isolamento Multi-Tenant** — ✅ **Compatível**. Os testes de contrato planejados (`memed-conformity-tenant-isolation.spec.ts`) verificam explicitamente que `prescription_records` e `memed_prescribers` não vazam entre tenants. Suíte de conformidade ESTENDE a defesa em camadas.

- **IV. Conformidade TUSS/ANS** — ✅ **Não aplicável**. Prescrição digital não usa códigos TUSS (segue codificação Memed). Sem impacto.

- **V. Segurança por Perfil de Acesso (RBAC)** — ✅ **Compatível**. Os endpoints exercitados por esta spec (`/api/integracoes/memed/*`, `/api/medicos/[id]/memed-*`, `/api/atendimentos/[id]/prescricoes`) já têm regras de RBAC no spec 026; nossa suíte adiciona testes de matriz papel×endpoint para garantir não-regressão.

**Restrições adicionais relevantes da seção "Restrições de Domínio & Compliance"**:

- **Persistência financeira append-only** → `prescription_records` é append-only por trigger (FR-008); spec verifica via teste de contrato.
- **LGPD / criptografia em repouso** → `tenant_memed_config.api_key/secret_key` são cifradas; teste de contrato valida que SELECT direto retorna ciphertext, não plaintext.
- **Tokens/segredos em cofre, não env versionadas** → FR-013 (lint rule) força isso; CI quebra se desenvolvedor importa env Memed em código de frontend.
- **Observabilidade com tenant_id, user_id, trace_id** → testes de log validam que máscara é aplicada e estrutura JSON do pino contém os campos.

**Resultado da Constitution Check**: ✅ **PASS, sem violações**. Não há entradas em "Complexity Tracking".

## Project Structure

### Documentation (this feature)

```text
specs/027-memed-conformidade/
├── plan.md              # Este arquivo
├── research.md          # Phase 0: shape dos eventos Memed, técnica de scan de credenciais
├── data-model.md        # Phase 1: entidades referenciadas (sem schema novo — vem do 026)
├── contracts/
│   ├── audit-matrix.md  # Matriz "9 critérios × testes que provam"
│   ├── memed-mock.md    # Contrato do mock de Memed usado em integração/E2E
│   └── credential-scan.md  # Contrato do script de scan de bundle JS
├── quickstart.md        # Phase 1: como rodar a suíte completa local + CI
├── checklists/
│   └── requirements.md  # (já gerado em /speckit.specify)
└── tasks.md             # Phase 2: gerado por /speckit.tasks (não por este comando)
```

### Source Code (repository root)

```text
src/                            # Pertence ao spec 026 — NÃO modificado por esta spec
  └── lib/core/integrations/memed/
                                # (tabelas, client, endpoints — 026)

tests/
├── contract/
│   ├── memed-prescriber-payload.spec.ts        # FR-001, FR-002
│   ├── memed-setpaciente-payload.spec.ts       # FR-004, FR-005
│   ├── memed-prescription-records-append-only.spec.ts  # FR-008
│   ├── memed-credentials-encrypted-at-rest.spec.ts     # FR-011
│   └── memed-audit-events.spec.ts              # FR-009
├── integration/
│   ├── memed-prescricaoImpressa.spec.ts        # FR-006
│   ├── memed-prescricaoExcluida.spec.ts        # FR-007
│   ├── memed-token-no-secret-leak.spec.ts      # FR-010, FR-014
│   └── memed-error-messages-no-credentials.spec.ts  # FR-014
└── e2e/                                        # Playwright (novo diretório)
    ├── playwright.config.ts
    ├── memed-credential-leak-scan.spec.ts      # FR-010, US5
    ├── memed-feature-toggle-respected.spec.ts  # FR-015, FR-016, US6
    └── memed-full-flow.spec.ts                 # smoke do fluxo completo

tools/
├── eslint-rules/
│   └── no-memed-secrets-in-frontend.js         # FR-013 (lint custom)
└── scripts/
    └── scan-bundle-for-memed-keys.ts           # FR-013 (post-build scan)

docs/
└── legal/
    └── memed-acceptance-record.md              # FR-017 (US7)

.github/workflows/
└── memed-conformidade.yml                      # CI dedicado (lint + scan + tests)
```

**Structure Decision**: stack web já existente (Next.js + Supabase). Esta spec adiciona apenas testes (`tests/`), tooling (`tools/`), documentação legal (`docs/legal/`) e um workflow CI (`.github/workflows/`).

**Exceção justificada**: T011 estende `src/lib/observability/logger.ts` adicionando paths de redact específicos da Memed (FR-012). É config change de uma linha (extensão do array `paths` do `pino` já configurado), não modifica lógica de produção, segue padrão pré-existente do projeto para mascaramento. Foi colocada nesta spec (e não no 026) porque é exigência direta de auditoria Memed (FR-012/SC-006) e o teste que valida (T029) também vive aqui. Toda outra alteração de `src/` continua sendo responsabilidade exclusiva do spec 026.

## Complexity Tracking

> Sem violações da Constitution Check. Tabela omitida.
