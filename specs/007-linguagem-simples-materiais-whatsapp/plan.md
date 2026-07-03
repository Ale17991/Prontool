# Implementation Plan: Materiais opcionais, atalho WhatsApp e linguagem simples

**Branch**: `007-linguagem-simples-materiais-whatsapp` | **Date**: 2026-04-30 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/007-linguagem-simples-materiais-whatsapp/spec.md`

## Summary

Três entregas independentes empacotadas em um único feature branch porque o usuário pediu juntas e elas não conflitam:

1. **Materiais (P1, FR-001 a FR-014)** — nova tabela `appointment_materials` (1:N com `appointments`, append-only, RLS por `tenant_id`, audit trigger), reuso do `<TussTypeahead table="19">` já existente em `src/components/tuss/tuss-typeahead.tsx`, novos endpoints REST `POST/GET /api/atendimentos/[id]/materiais`, e extensão do `POST /api/atendimentos/manual` para aceitar `materiais[]` no payload com persistência atômica via RPC.
2. **WhatsApp (P3, FR-015 a FR-019)** — botão `<a target="_blank">` em `/operacao/pacientes/[id]/page.tsx`, helper puro `formatPhoneForWhatsApp(raw)` em `src/lib/utils/`. Zero backend, zero migration.
3. **Linguagem (P2, FR-020 a FR-027)** — varredura cirúrgica de strings literais em arquivos de UI (`src/app/(dashboard)/**`, `error.tsx`, `not-found.tsx`, mensagens Zod com `message:`, PDFs gerados em `src/lib/core/patient-medical/`, e-mails). Zero mudança em banco, audit_log, nomes de tabela ou código de domínio. A regra é: apenas strings que renderizam para o usuário final mudam.

A entrega segue prioridade do spec. Nenhum dos três trabalhos depende do outro — podem ser implementados em qualquer ordem ou paralelizados; ainda assim, a recomendação é começar por (1) Materiais (escopo estável e bem definido), seguir com (3) Linguagem (varredura ampla, ajuste mais oportuno enquanto outros arquivos estão sendo tocados) e fechar com (2) WhatsApp (trivial, 1 arquivo).

## Technical Context

**Language/Version**: TypeScript 5.4 sobre Node.js 20 LTS (runtime Vercel)
**Primary Dependencies**: Next.js 14.2 (App Router), React 18.3, `@supabase/ssr` 0.5, `@supabase/supabase-js` 2.45, Zod 3.23, Tailwind CSS 3.4, shadcn/ui (Radix primitives), `date-fns` 4.1, `lucide-react`, Pino 9
**Storage**: PostgreSQL via Supabase (local dev: `supabase start`, porta 54321) com RLS por `tenant_id`. Próxima migration: **`0061_appointment_materials.sql`**. Tabelas tocadas: nova `appointment_materials`; tabela existente `tuss_codes` (somente leitura, filtro `tuss_table='19'`); `audit_log` (uso, sem schema change). Sem mudanças em banco para Features 2 e 3.
**Testing**: Vitest (unit + integration), `pnpm test`, `pnpm test:integration`, `pnpm test:contract`. Tipagem: `pnpm typecheck` após cada arquivo (regra do projeto). Linter de auth: `pnpm lint:auth` para garantir `requireRole` em todas as rotas novas.
**Target Platform**: Web — Vercel serverless (rotas `/api/*`) + SSR pages (`src/app/**`). Browser alvo: Chrome 120+, Safari 17+, Firefox 120+ (consistente com features anteriores).
**Project Type**: Web application monorepo Next.js (sem split frontend/backend — App Router). Source tree em `src/`, migrações em `supabase/migrations/`, especificações em `specs/`.
**Performance Goals**: typeahead TUSS com p95 ≤ 250 ms (já alcançado em /cadastros/procedimentos com debounce de 250 ms, herdado pelo componente). Persistência atômica de até 20 materiais por atendimento sem regressão perceptível no salvamento (atual ~150 ms p95 em `POST /api/atendimentos/manual`).
**Constraints**: append-only — `UPDATE`/`DELETE` em `appointment_materials` é proibido por trigger (alinhado a Principle I). Multi-tenant rígido — RLS no banco + filtro de `tenant_id` no service (Principle III). RBAC server-side em todos os endpoints novos (Principle V). Quantidade ≤ 0 ou não inteira deve falhar com erro 400 antes de tocar o banco (validação Zod). Para feature 3: regra "Algo deu errado…" só vale para erros genéricos não classificados — `DomainError` com mensagem específica preserva o texto original.
**Scale/Scope**:

- Materiais: estimado 0–5 itens por atendimento médio, picos ≤ 20. Catálogo TUSS tabela 19 tem ~3000 códigos vigentes.
- Linguagem: varredura em ~45 arquivos identificados na pesquisa preliminar (Phase 0); a maioria dos 119 hits encontrados no grep são em código/comentários internos (não-UI) que **não** devem mudar. Os arquivos efetivamente alterados ficam em torno de **15–25 arquivos** de UI/PDF/error pages.
- WhatsApp: 1 botão em 1 página + 1 helper puro com testes.

## Constitution Check

_GATE: Must pass before Phase 0 research. Re-check after Phase 1 design._

| Princípio                                    | Aplicação                                                                                                                                                                                                                                                                                                                                                                                                                                                              | Veredito |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| **I. Integridade Financeira Imutável**       | `appointment_materials` não armazena valor monetário (apenas código TUSS, descrição, quantidade) — não cria nova superfície financeira. Mas a regra de imutabilidade aplica-se: tabela é append-only via trigger `enforce_appointment_materials_mutation` (espelha o padrão de `expenses`/`appointment_reversals`). Nenhum `UPDATE` ou `DELETE` físico permitido pela API regular. Materiais ficam congelados no momento da inserção (snapshot de `tuss_description`). | ✅ PASS  |
| **II. Auditabilidade Total de Preços**       | `appointment_materials` recebe trigger de audit (`audit_appointment_materials`) que insere em `audit_log` em todo INSERT — ator (`created_by`), `tenant_id`, entidade, valores. Mesmo padrão de `audit_appointments` da migration 0013.                                                                                                                                                                                                                                | ✅ PASS  |
| **III. Isolamento Multi-Tenant**             | `tenant_id` NOT NULL na tabela nova, RLS habilitado, política `appointment_materials_tenant_isolation` com `USING/WITH CHECK (tenant_id = current_tenant_id())`. PK é UUID. Endpoints `/api/atendimentos/[id]/materiais` validam que o `appointment_id` pertence ao tenant antes de ler/escrever.                                                                                                                                                                      | ✅ PASS  |
| **IV. Conformidade TUSS/ANS**                | Materiais usam código TUSS oficial tabela 19 (catálogo já importado em `tuss_codes` via migrations 0003+0037). Endpoint typeahead consulta apenas `valid_to IS NULL` (códigos vigentes — comportamento existente em `searchTussCatalog`). Códigos retirados continuam aparecendo em registros históricos via `tuss_description` congelada.                                                                                                                             | ✅ PASS  |
| **V. Segurança por Perfil de Acesso (RBAC)** | Endpoints novos chamam `requireRole(['admin', 'recepcionista', 'profissional_saude'])` (mesma policy de `/api/atendimentos/manual`). UI esconde botão "+ Adicionar material" não como mecanismo de segurança, mas como UX — o servidor é fonte de verdade. Tentativas negadas geram audit entry (já garantido pelo `requireRole` existente).                                                                                                                           | ✅ PASS  |

**Restrições de domínio adicionais relevantes**:

- LGPD: nenhum dado pessoal novo coletado; materiais são códigos clínicos, não PII. ✅
- UTC: `created_at` em `TIMESTAMPTZ DEFAULT now()` (UTC). ✅
- Moeda: N/A (sem valor monetário em materiais). ✅
- Observabilidade: Pino logger nos route handlers; eventos estruturados com `tenant_id`+`user_id`+`trace_id`. ✅

**Para Feature 3 (Linguagem)**:

- Principle II (auditabilidade) reforça que `event_type='appointment.reversed'` no `audit_log` **NÃO** muda — apenas a UI que renderiza esse evento. ✅
- Principle I é compatível com a renomeação UI: imutabilidade está em "não editar valor", não em "não renomear rótulo".

**Para Feature 2 (WhatsApp)**: nenhum princípio acionado (UI pura, sem persistência, sem dados novos). ✅

**Resultado**: ✅ **PASS — sem violações de constituição. Complexity Tracking não preenchido.**

## Project Structure

### Documentation (this feature)

```text
specs/007-linguagem-simples-materiais-whatsapp/
├── plan.md              # Este arquivo
├── research.md          # Phase 0 — decisões investigadas
├── data-model.md        # Phase 1 — modelagem da tabela appointment_materials
├── quickstart.md        # Phase 1 — passo a passo de validação manual
├── contracts/
│   ├── appointment-materials-api.md   # POST/GET /api/atendimentos/[id]/materiais
│   └── manual-create-extension.md     # Extensão do payload de POST /api/atendimentos/manual
├── checklists/
│   └── requirements.md                # Spec quality checklist (já existente)
└── tasks.md             # Phase 2 — gerado por /speckit-tasks (não nesta phase)
```

### Source Code (repository root)

Repositório Next.js já estabelecido. **Estrutura existente preservada** — esta feature não cria novos diretórios de topo. Apenas adiciona arquivos dentro da estrutura atual e edita arquivos existentes.

```text
src/
├── app/
│   ├── (dashboard)/
│   │   ├── operacao/
│   │   │   ├── atendimentos/
│   │   │   │   ├── [id]/
│   │   │   │   │   └── page.tsx                       # EDIT — exibe materiais na visualização
│   │   │   │   └── novo/
│   │   │   │       └── new-appointment-form.tsx       # EDIT — adiciona seção "Materiais utilizados"
│   │   │   └── pacientes/
│   │   │       └── [id]/
│   │   │           ├── page.tsx                       # EDIT — botão WhatsApp + revisão linguagem
│   │   │           ├── treatment-steps-section.tsx    # EDIT — adiciona seção "Materiais utilizados" no fluxo de finalização de etapa
│   │   │           └── medical-history-section.tsx    # EDIT — exibe materiais e revisão linguagem (NKDA → "Sem alergias conhecidas")
│   │   └── operacao/dlq/                               # EDIT (rename na UI) — "DLQ" → "Pendências" (rota de URL preservada)
│   ├── api/
│   │   ├── atendimentos/
│   │   │   ├── [id]/
│   │   │   │   ├── materiais/
│   │   │   │   │   └── route.ts                       # NEW — POST/GET handler
│   │   │   │   └── ...                                # existente
│   │   │   └── manual/
│   │   │       └── route.ts                           # EDIT — aceita campo opcional `materiais` no body
│   │   └── webhooks/                                   # NÃO TOCAR (continua sendo "webhook" no código; UI nunca mostra)
│   └── error.tsx, not-found.tsx                        # EDIT — mensagem genérica "Algo deu errado…"
├── components/
│   ├── tuss/
│   │   └── tuss-typeahead.tsx                         # REUSE — já aceita `table='19'`
│   ├── ui/
│   │   └── ...                                        # shadcn primitives (Button, Tooltip)
│   └── atendimentos/                                   # NEW (se necessário)
│       └── materiais-editor.tsx                       # NEW — componente reutilizável que encapsula a lista local de materiais com typeahead, quantidade e botão remover
├── lib/
│   ├── core/
│   │   ├── appointments/
│   │   │   ├── create-manual.ts                       # EDIT — aceita `materiais` opcional, persiste em transação
│   │   │   └── materials/                              # NEW (subdir)
│   │   │       ├── attach.ts                          # NEW — service de inserção
│   │   │       └── list.ts                            # NEW — service de leitura
│   │   ├── treatment-steps/
│   │   │   └── create-with-appointment.ts             # EDIT — aceita `materiais` opcional na finalização da etapa
│   │   └── patient-medical/
│   │       ├── assemble-prontuario.ts                 # EDIT — agrega materiais por atendimento
│   │       └── prontuario-pdf.tsx                     # EDIT — renderiza materiais no PDF
│   └── utils/
│       └── whatsapp.ts                                # NEW — helper puro `formatPhoneForWhatsApp(raw): string | null`
└── ...

supabase/
└── migrations/
    └── 0061_appointment_materials.sql                  # NEW — tabela + RLS + triggers append-only e audit
```

**Structure Decision**: Mantemos a convenção atual do repositório — App Router com domínios em `src/lib/core/<domain>/<verb>.ts` e rotas REST em `src/app/api/`. Novos serviços de materiais ficam em `src/lib/core/appointments/materials/` (subdir do domínio existente, não um novo domínio). O componente de UI fica em `src/components/atendimentos/` (criação justificada porque hoje não existe lugar canônico para componentes específicos de atendimentos — alternativa rejeitada: colocar em `src/app/(dashboard)/operacao/atendimentos/_components/`, mas o componente é compartilhado entre `novo` e `treatment-steps-section`, então fica fora da rota).

## Phase 0: Research

Os pontos de pesquisa abaixo foram resolvidos durante o estudo do código existente. **Nenhum NEEDS CLARIFICATION resta**. Detalhe completo em `research.md`.

| #   | Pergunta                                                                                       | Decisão                                                                                                                                                                                                                                                                                                        | Fonte                                                                                                                 |
| --- | ---------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| R1  | Catálogo TUSS tabela 19 já está populado?                                                      | **Sim**, importado via `pnpm seed:tuss` (migrations 0003 + 0037 + seed). `searchTussCatalog` aceita `table: '19'` e o `<TussTypeahead>` aceita `table` prop sem alteração.                                                                                                                                     | `src/lib/core/catalog/list-tuss.ts`, `src/components/tuss/tuss-typeahead.tsx`                                         |
| R2  | Como persistir materiais atomicamente com a criação do atendimento?                            | Estender `createAppointmentManually` para aceitar `materiais?: MaterialInput[]` e fazer 2 inserts sequenciais dentro da mesma request (Supabase JS client não tem transações multi-statement; mitigamos com **RPC SQL** `create_appointment_with_materials` em `0061`). Para `treatment-steps`, mesmo padrão.  | `src/lib/core/appointments/create-manual.ts`, `src/lib/core/treatment-steps/create-with-appointment.ts`               |
| R3  | Padrão de RLS + audit + append-only para nova tabela                                           | Espelhar `expense_receipts` (migration 0058/0059): trigger `enforce_appointment_materials_mutation` rejeita UPDATE/DELETE de role não-admin; trigger `audit_appointment_materials` insere em `audit_log` no INSERT. RLS policy `tenant_id = current_tenant_id()`.                                              | `supabase/migrations/0058_expense_receipts.sql`, `supabase/migrations/0059_expense_receipts_table_and_particular.sql` |
| R4  | Onde o botão WhatsApp deve viver na ficha do paciente?                                         | Ao lado do bloco de contato em `page.tsx` (header da ficha). Helper de formatação em `src/lib/utils/whatsapp.ts` (puro, testável). Componente `<WhatsAppButton phone={...} />` opcional, mas se for usado em só um lugar, inline no page.tsx é suficiente.                                                     | `src/app/(dashboard)/operacao/pacientes/[id]/page.tsx`                                                                |
| R5  | Quais arquivos contêm strings UI proibidas?                                                    | Grep preliminar: 45 arquivos com 119 hits. Nem todos são UI — após filtragem (excluir `src/lib/core/`, `src/lib/integrations/`, `src/lib/auth/`, comentários, type definitions), estimam-se **15–25 arquivos** que renderizam para usuário final. Lista completa será construída em Phase 1 antes da execução. | `src/app/(dashboard)/**`, `error.tsx`, `not-found.tsx`, `src/lib/core/reports/`, `src/lib/core/patient-medical/`      |
| R6  | Como manter `event_type='appointment.reversed'` em audit_log enquanto a UI mostra "Cancelado"? | A UI lê o evento e renderiza um label traduzido. Criar helper `src/lib/utils/audit-labels.ts` com `eventTypeToLabel(t)` que faz o mapeamento `appointment.reversed → 'Cancelamento de atendimento'`. Banco e logs continuam intactos.                                                                          | Decisão de design                                                                                                     |
| R7  | Mensagens de erro com `digest` (Next.js) — onde são renderizadas?                              | `src/app/error.tsx` e `src/app/(dashboard)/operacao/pacientes/error.tsx`. Hoje exibem `error.digest` no fallback. Substituir por mensagem genérica + log do digest no `console.error` (que vai pra Pino na Vercel).                                                                                            | `src/app/(dashboard)/operacao/pacientes/error.tsx`                                                                    |
| R8  | Pluralização "Estornado" → "Cancelado" — substituição cega ou caso a caso?                     | **Caso a caso**, conforme edge case do spec. Cada arquivo revisado individualmente; usar grep para identificar, mas substituir manualmente respeitando gênero/plural ("Atendimento cancelado", "Etapa cancelada"). Sem `replace_all`.                                                                          | Edge case do spec                                                                                                     |

## Phase 1: Design & Contracts

### Data Model

**Nova tabela**: `appointment_materials`

| Coluna             | Tipo        | Constraints                                        | Notas                                          |
| ------------------ | ----------- | -------------------------------------------------- | ---------------------------------------------- |
| `id`               | UUID        | PK, DEFAULT `gen_random_uuid()`                    |                                                |
| `tenant_id`        | UUID        | NOT NULL, FK `tenants(id) ON DELETE RESTRICT`      | RLS scope                                      |
| `appointment_id`   | UUID        | NOT NULL, FK `appointments(id) ON DELETE RESTRICT` | 1:N                                            |
| `tuss_code`        | TEXT        | NOT NULL, FK `tuss_codes(code) ON DELETE RESTRICT` | apenas tabela 19 (validado em service, não FK) |
| `tuss_description` | TEXT        | NOT NULL                                           | snapshot — congela texto no momento do INSERT  |
| `quantity`         | INTEGER     | NOT NULL, DEFAULT 1, CHECK `> 0`                   |                                                |
| `created_by`       | UUID        | NOT NULL, FK `auth.users(id) ON DELETE RESTRICT`   | ator                                           |
| `created_at`       | TIMESTAMPTZ | NOT NULL, DEFAULT `now()`                          | UTC                                            |

**Índices**:

- `appointment_materials_appointment_idx (appointment_id)` — leitura por atendimento (caso primário)
- `appointment_materials_tenant_idx (tenant_id, created_at DESC)` — relatórios futuros

**Triggers**:

- `enforce_appointment_materials_mutation` BEFORE UPDATE/DELETE → RAISE EXCEPTION (exceto `service_role`)
- `audit_appointment_materials` AFTER INSERT → INSERT em `audit_log` (entity_type='appointment_material', event_type='appointment_material.created')

**RLS**:

- ENABLE ROW LEVEL SECURITY
- `appointment_materials_tenant_isolation` USING `tenant_id = current_tenant_id()` WITH CHECK `tenant_id = current_tenant_id()`

**RPC**: `create_appointment_with_materials(p_appointment_payload jsonb, p_materials jsonb)` — chamada por `createAppointmentManually` quando há materiais. SECURITY INVOKER (respeita RLS), executa em transação implícita do PostgreSQL. Retorna `appointment_id`.

Detalhamento completo em `data-model.md`.

### Contracts

**1. `POST /api/atendimentos/[id]/materiais`** — anexar materiais a atendimento existente.

```http
POST /api/atendimentos/{id}/materiais
Content-Type: application/json

{
  "materiais": [
    { "tuss_code": "70000010", "tuss_description": "GAZE ESTERIL 7,5x7,5cm", "quantity": 3 },
    { "tuss_code": "70000028", "tuss_description": "SERINGA DESCARTAVEL 5ML", "quantity": 1 }
  ]
}
```

Respostas:

- `201 Created` — `{ "appointment_id": "...", "materials": [{ "id": "...", "tuss_code": "...", ... }] }`
- `400 Bad Request` — payload inválido (quantity ≤ 0, código fora da tabela 19)
- `401/403` — `requireRole`
- `404 Not Found` — atendimento não pertence ao tenant
- `409 Conflict` — atendimento já foi cancelado (`reversed`) → não aceita novos materiais

**2. `GET /api/atendimentos/[id]/materiais`** — listar materiais do atendimento.

Resposta `200 OK`:

```json
{
  "materials": [
    {
      "id": "...",
      "tuss_code": "70000010",
      "tuss_description": "GAZE...",
      "quantity": 3,
      "created_at": "..."
    }
  ]
}
```

**3. Extensão do `POST /api/atendimentos/manual`** — body ganha campo opcional:

```ts
{
  // ...campos existentes
  materiais: z.array(
    z.object({
      tuss_code: z.string().min(1),
      tuss_description: z.string().min(1),
      quantity: z.number().int().positive().default(1),
    }),
  ).optional()
}
```

Quando `materiais` está presente e não vazio, o handler chama o RPC SQL `create_appointment_with_materials` em vez do INSERT direto, garantindo atomicidade. Quando ausente ou vazio, mantém o caminho atual.

Contratos completos em `contracts/`.

### Quickstart (validação manual pós-implementação)

Sequência sugerida em `quickstart.md`:

1. `pnpm supabase:reset` — aplica todas as migrations incluindo 0061.
2. `pnpm dev` — sobe Next em :3000.
3. **Materiais (caminho feliz)**: criar atendimento manual com 2 materiais, salvar, abrir timeline do paciente, conferir lista, gerar PDF do prontuário, conferir bloco de materiais.
4. **Materiais (caminho vazio)**: criar atendimento sem materiais, conferir que sub-seção não aparece.
5. **WhatsApp**: paciente com telefone, clicar botão → nova aba com URL correta. Paciente sem telefone → botão desabilitado + tooltip.
6. **Linguagem**: forçar erro em qualquer rota → conferir mensagem genérica sem `digest`. Reverter atendimento → badge "Cancelado". Página de pendências (antes "DLQ") → título "Pendências".
7. `pnpm typecheck && pnpm lint:auth && pnpm test` — todos verdes.

### Agent Context Update

A rodar ao fim da Phase 1: `& .specify/scripts/powershell/update-agent-context.ps1 -AgentType claude` para sincronizar o `CLAUDE.md` (seção "Active Technologies" e "Recent Changes") com a nova entrada da feature 007. Sem novas dependências — todas as bibliotecas usadas já estão no projeto.

### Constitution Re-check (post-design)

Reavaliando após design:

- Tabela `appointment_materials` permanece append-only e tenant-isolada — ✅
- RPC `create_appointment_with_materials` é SECURITY INVOKER (não escapa RLS) — ✅
- Endpoints seguem `requireRole` + Zod — ✅
- Helper `audit-labels.ts` mapeia label de UI sem mexer em `event_type` — ✅
- Substituição de strings de UI não toca em audit_log nem em código de domínio — ✅

**Veredito final**: ✅ **PASS sem violações.** Complexity Tracking permanece vazio.

## Complexity Tracking

> Sem violações. Tabela vazia.

| Violation   | Why Needed | Simpler Alternative Rejected Because |
| ----------- | ---------- | ------------------------------------ |
| _(nenhuma)_ |            |                                      |
