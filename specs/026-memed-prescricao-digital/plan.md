# Implementation Plan: Integração Memed — Prescrição Digital

**Branch**: `026-memed-prescricao-digital` | **Date**: 2026-05-26 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/026-memed-prescricao-digital/spec.md`

## Summary

Habilitar prescrição digital da Memed dentro do fluxo de atendimento/prontuário, **por clínica** (cada tenant conecta sua própria conta Memed). A abordagem reusa a infraestrutura multi-tenant de integrações já existente (`tenant_integrations` com `credentials_enc`, padrão GHL/feature 008) para guardar o par api-key/secret-key cifrado por tenant; implementa a lógica Memed como uma **cápsula de domínio** (`src/lib/core/integrations/memed/`) — único lugar autorizado a decifrar credenciais e falar com a API Memed (JSON:API, chaves apenas na query server-side). Os profissionais de cada clínica são registrados como prescritores sob a conta daquela clínica; o token JWT (dinâmico) é entregue ao frontend por um **endpoint proxy** server-side (as chaves nunca saem do servidor). O frontend, na tela de atendimento, carrega o script da Memed, pré-carrega o paciente (decifrado via `get_patient_for_tenant`) e captura `prescricaoImpressa`/`prescricaoExcluida` para registro auditável. Tudo construível e validável em **homologação** (chaves públicas da doc) sem aprovação de produção.

## Technical Context

**Language/Version**: TypeScript 5.4 sobre Node.js 20 LTS (runtime Vercel)
**Primary Dependencies**: Next.js 14.2 (App Router, Route Handlers, Server Actions, RSC), `@supabase/ssr` 0.5 / `@supabase/supabase-js` 2.45, Zod 3.23, Pino 9, Tailwind 3.4, shadcn/ui. **Sem novas deps de runtime** — `fetch` nativo + `AbortSignal.timeout(5000)` para a API Memed; carregamento do script Memed via `<script>` no cliente.
**Storage**: PostgreSQL via Supabase (local: `supabase start` :54321) com RLS por `tenant_id`. **Migration nova**: `0108_memed_prescription.sql`. **Tabelas novas**: `tenant_memed_config` (credenciais por clínica, cifradas via `enc_text_with_key`), `memed_prescribers`, `prescription_records`. **Tabelas tocadas (uso)**: `audit_log` (via `log_audit_event`). **Sem mudança** em `tenant_integrations` (decisão D1: Memed é request/response, não event-bus — tabela dedicada em vez de reusar o provider GHL), nem em `doctors`/`patients` (campos já existem: `doctors.cpf/council_state/birth_date` da 0107; paciente em `_enc`).
**Testing**: Vitest — `pnpm test`, `pnpm test:integration`, `pnpm test:contract` (contrato de isolamento multi-tenant + RBAC por endpoint), `pnpm typecheck`, `pnpm lint:auth`.
**Target Platform**: Web app SSR (Vercel) + navegadores modernos (requisito do módulo Memed: Chrome 112+, Firefox 112+, Safari 15.6+, Edge 111+).
**Project Type**: Web application full-stack (Next.js) — usa a estrutura existente do repositório (`src/app`, `src/lib/core`, `src/lib/integrations`, `supabase/migrations`).
**Performance Goals**: abertura da prescrição com paciente pré-carregado em ≤5s (SC-001); chamadas à API Memed com timeout de 5s e mensagem amigável em falha.
**Constraints**: nenhum segredo Memed no frontend/logs/respostas ao browser (FR-004a, SC-002); PII de paciente decifrada só no servidor e entregue ao usuário autorizado (FR-013); timestamps UTC na persistência; isolamento por tenant em 3 camadas; `lint:auth` proíbe `process.env` de provider direto fora da cápsula de credenciais.
**Scale/Scope**: 2 tabelas novas, ~6–7 Route Handlers, 1 cápsula de domínio (`memed/`), 1 página de config por clínica, 1 componente lançador no atendimento. Volume por clínica: dezenas de prescritores, milhares de prescrições/ano.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Princípio | Avaliação | Como o plano atende |
|-----------|-----------|---------------------|
| **I. Integridade Financeira Imutável** | ✅ N/A direto + aplicado por analogia | Prescrição não é registro financeiro. Ainda assim, `prescription_records` é **append-only**: emissão insere; exclusão NÃO apaga linha — registra `deleted_at`/status via caminho guardado por trigger (anti-`DELETE`, anti-`UPDATE` exceto a transição emitida→excluída). |
| **II. Auditabilidade Total** | ✅ | Habilitar prescritor, emitir e excluir prescrição emitem `log_audit_event` (ator, timestamp UTC, tenant, entidade, origem). Conteúdo clínico **não** é copiado — só metadados de rastreabilidade (FR-019). |
| **III. Isolamento Multi-Tenant** | ✅ | Tabelas novas com `tenant_id` + RLS; credenciais por tenant em `tenant_integrations`; o endpoint de token valida tenant/escopo do profissional; PKs UUID. Teste de contrato de vazamento entre tenants. |
| **IV. Conformidade TUSS/ANS** | ✅ N/A | Prescrição de medicamento não usa catálogo TUSS (TUSS é faturamento de procedimento). Sem interação com o catálogo TUSS. |
| **V. Segurança por Perfil (RBAC)** | ✅ | Conectar/desconectar conta e habilitar prescritor = `admin`; emitir/registrar prescrição = `profissional_saude` (dono do atendimento); token proxy é self-scoped ao profissional logado. `requireRole` server-side em todos os handlers; negações logadas. |
| **Domínio/LGPD/Segredos** | ✅ | Credenciais cifradas em `tenant_integrations.credentials_enc` (não em env versionado); chaves Memed só server-side (token via proxy); PII de paciente decifrada via RPC só no servidor e entregue ao browser do usuário autorizado; logs com PII mascarada; timestamps UTC. |

**Resultado**: Sem violações. "Complexity Tracking" vazio.

## Project Structure

### Documentation (this feature)

```text
specs/026-memed-prescricao-digital/
├── plan.md              # Este arquivo
├── research.md          # Phase 0 — decisões técnicas
├── data-model.md        # Phase 1 — entidades, RLS, triggers
├── quickstart.md        # Phase 1 — como rodar/validar em homologação
├── contracts/
│   ├── memed-external-api.md     # contrato da API Memed que consumimos
│   └── internal-endpoints.md     # contrato dos nossos Route Handlers
├── checklists/
│   └── requirements.md  # checklist de qualidade da spec (já criado)
└── tasks.md             # Phase 2 (/speckit.tasks — NÃO criado aqui)
```

### Source Code (repository root)

```text
src/
├── app/
│   ├── (dashboard)/
│   │   ├── configuracoes/integracoes/memed/      # página de conexão por clínica (admin)
│   │   │   ├── page.tsx
│   │   │   └── memed-connection-form.tsx
│   │   └── operacao/atendimentos/...             # ponto de entrada do botão "Prescrever"
│   │       └── prescrever-launcher.tsx           # client component (script + MdHub)
│   └── api/
│       ├── integracoes/memed/
│       │   ├── route.ts                          # POST connect / DELETE disconnect (admin)
│       │   └── especialidades/route.ts           # GET proxy catálogo especialidades
│       ├── medicos/[id]/
│       │   ├── memed-prescritor/route.ts         # POST habilitar prescritor (admin)
│       │   └── memed-token/route.ts              # GET token proxy (profissional/self)
│       └── atendimentos/[id]/
│           ├── memed-paciente/route.ts           # GET payload decifrado p/ setPaciente
│           └── prescricoes/route.ts              # POST registrar emissão / PATCH exclusão
├── lib/
│   ├── core/integrations/memed/                  # CÁPSULA — único lugar que decifra+chama Memed
│   │   ├── client.ts                             # fetch JSON:API + env→baseURL + timeout
│   │   ├── credentials.ts                        # lê tenant_integrations + decripta (reusa core/integrations/credentials)
│   │   ├── register-prescriber.ts
│   │   ├── get-prescriber-token.ts
│   │   ├── list-specialties.ts
│   │   ├── record-prescription.ts                # emissão/exclusão + audit
│   │   └── mask-pii.ts
│   └── core/integrations/...                      # helpers existentes reaproveitados
└── supabase/migrations/
    └── 0108_memed_prescription.sql

tests/
├── contract/
│   ├── memed-tenant-isolation.spec.ts            # vazamento entre tenants impossível
│   ├── memed-rbac.spec.ts                         # cada papel × cada endpoint
│   └── prescription-records-append-only.spec.ts  # anti-update/delete
└── integration/
    ├── memed-connect-and-enable-prescriber.spec.ts
    ├── memed-token-proxy-no-secret-leak.spec.ts
    └── memed-record-issued-and-deleted.spec.ts
```

**Structure Decision**: Web app full-stack na estrutura existente do projeto. A lógica Memed vive em `src/lib/core/integrations/memed/` (cápsula análoga à `ghl/oauth/` da feature 008) — **único** lugar autorizado a ler credenciais decifradas e chamar a Memed; nenhum Route Handler chama a Memed diretamente. As credenciais por clínica ficam em tabela dedicada `tenant_memed_config` (decisão D1), cifradas pelos mesmos RPCs `enc_text_with_key`/`dec_text_with_key`. Três tabelas novas (`tenant_memed_config`, `memed_prescribers`, `prescription_records`).

## Phasing (entrega faseada)

- **Fase A — Fundação** (bloqueante): migration 0108 (tabelas + RLS + triggers append-only), cápsula `memed/client.ts` + `credentials.ts`, conexão por clínica (connect/disconnect em `tenant_integrations`), testes de contrato (isolamento, RBAC, append-only). Validável: conectar conta de homologação.
- **Fase B — US2 (P1)**: habilitar profissional como prescritor (valida campos, `POST /usuarios`, upsert `memed_prescribers`, seleção de especialidade) + token proxy. Validável: profissional fica "apto".
- **Fase C — US1 (P1)**: botão "Prescrever" no atendimento → script + `setPaciente` (payload decifrado) + `module.show` → emissão em homologação. MVP de valor.
- **Fase D — US3 (P2)**: registrar emissão/exclusão (`prescricaoImpressa`/`prescricaoExcluida`) + audit + indicador no prontuário.
- **Fase E — US4 (P2)**: de-para de especialidade (catálogo Memed) refinado.
- **Fase F — US5 (P3)**: alternância homologação→produção por clínica, aceite de termo de responsabilidade, checklist dos 5 requisitos de conformidade.

## Complexity Tracking

> Sem violações constitucionais — nada a justificar.
