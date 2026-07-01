# Tipos da API — Front-end Homio Faturamento

Documento autocontido pra construir o front-end. Todos os tipos abaixo são
TypeScript que casam com o que as rotas Route Handlers do Next.js devolvem
(JSON serializado).

> **Convenção geral**
>
> - Todas as rotas exigem `Authorization: Bearer <jwt>` exceto `/api/webhooks/*`
>   (validação de assinatura GHL) e `/api/workers/*` (validação de assinatura QStash).
> - Resposta de erro padrão (quando o handler chama `toHttpResponse`):
>   ```ts
>   interface ErrorResponse {
>     error: {
>       code: string // ex: 'FORBIDDEN', 'NOT_FOUND', 'INVALID_BODY'
>       message: string
>       meta?: Record<string, unknown>
>     }
>   }
>   ```
>   Códigos HTTP comuns: 400 payload inválido, 401 sem sessão, 403 papel sem
>   permissão, 404 entidade não encontrada, 409 conflito (concorrência ou
>   duplicidade), 500 erro técnico.
> - Datas em ISO 8601 (`'2026-04-17T13:25:00.000Z'`); somente data em
>   `'YYYY-MM-DD'`.
> - Valores monetários em **centavos** (`amount_cents: number`); converter
>   pra reais dividindo por 100 só na hora de exibir.
> - `bps` (basis points): `4000` = 40,00%. Comissão sempre em bps.

---

## Sumário de papéis (RBAC)

```ts
type TenantRole = 'admin' | 'financeiro' | 'recepcionista' | 'profissional_saude'
```

Matriz resumida (campo `role` da sessão controla o que aparece na UI):

| Ação                                                     | admin | financeiro | recepcionista |  profissional_saude  |
| -------------------------------------------------------- | :---: | :--------: | :-----------: | :------------------: |
| Ler atendimentos / preços / procedures / plans / médicos |  ✅   |     ✅     |      ✅       | ✅ (só atendimentos) |
| Reverter atendimento                                     |  ✅   |     ✅     |      ❌       |          ❌          |
| Criar/alterar preço, procedimento, plano, médico         |  ✅   |     ❌     |      ❌       |          ❌          |
| Ler/exportar auditoria                                   |  ✅   |     ❌     |      ❌       |          ❌          |
| Ler/resolver alertas, ler/reprocessar DLQ                |  ✅   |     ✅     |      ❌       |          ❌          |
| Gerar relatório mensal                                   |  ✅   |     ✅     |      ❌       |          ❌          |

Quando o usuário não tem permissão, o backend devolve **403** e grava uma
linha em `audit_log` com `result='denied'`.

---

## Sessão

```ts
interface ActiveSession {
  userId: string // uuid
  email: string | null
  tenantId: string // uuid
  role: TenantRole
}
```

O front-end **não** monta o JWT — `@supabase/ssr` cuida via
`signInWithPassword`. Os Route Handlers leem o bearer ou os cookies de
sessão automaticamente.

---

## US1 — Atendimentos, Alertas, DLQ

### `GET /api/atendimentos`

Lista os atendimentos efetivos do tenant.

```ts
interface AppointmentEffective {
  id: string // uuid
  appointment_at: string // ISO timestamp
  patient_id: string // uuid
  doctor_id: string // uuid
  procedure_id: string // uuid
  plan_id: string // uuid
  frozen_amount_cents: number
  frozen_commission_bps: number
  effective_status: 'ativo' | 'estornado'
  net_amount_cents: number // = frozen + reversal (0 se estornado)
  net_commission_cents: number
  reversal_id: string | null
  reversed_at: string | null
}

// Query string
interface ListAppointmentsQuery {
  from?: string // 'YYYY-MM-DD' inclusive
  to?: string // 'YYYY-MM-DD' inclusive
  doctor_id?: string
  plan_id?: string
  status?: 'ativo' | 'estornado' | 'todos' // default 'todos'
}

type ListAppointmentsResponse = AppointmentEffective[]
```

### `GET /api/atendimentos/{id}`

```ts
interface GetAppointmentResponse {
  appointment: AppointmentEffective
  audit: AuditRow[] // ver tipo em "Auditoria" abaixo
}
```

### `POST /api/atendimentos/{id}/reversal`

**Permissão:** `admin`, `financeiro`. Body:

```ts
interface ReverseAppointmentRequest {
  reason: string // mínimo 3 caracteres
}

interface ReverseAppointmentResponse {
  id: string // uuid do registro de reversão
  appointment_id: string
  reversal_amount_cents: number // sempre negativo
  reason: string
}
```

Códigos de erro relevantes:

- `403` — papel não autorizado
- `404` — atendimento não encontrado no tenant
- `409` — `code: 'APPOINTMENT_ALREADY_REVERSED'` (já houve reversão)

### `GET /api/alertas`

```ts
type AlertType =
  | 'dlq_event'
  | 'webhook_rejected'
  | 'tuss_deprecated'
  | 'signature_failure'
  | 'rbac_denied'

type AlertStatus = 'aberto' | 'resolvido'

interface Alert {
  id: string
  type: AlertType
  status: AlertStatus
  detail: Record<string, unknown> // chaves variam por tipo; safe pra render como JSON
  subject_ref: Record<string, unknown> | null
  email_sent_to: string[]
  email_last_sent_at: string | null
  resolved_at: string | null
  resolved_by: string | null
  created_at: string
}

interface ListAlertsQuery {
  status?: 'aberto' | 'resolvido' | 'todos'
  type?: AlertType
}

type ListAlertsResponse = Alert[]
```

### `POST /api/alertas/{id}/resolve`

**Permissão:** `admin`. Body opcional `{ note?: string }`. Resposta:

```ts
interface ResolveAlertResponse {
  id: string
  status: 'resolvido'
  resolved_at: string
  resolved_by: string
}
```

### `GET /api/alertas/dlq`

**Permissão:** `admin`, `financeiro`.

```ts
interface DlqEvent {
  id: string
  ghl_event_id: string
  received_at: string
  failure_reason: string | null
  processing_attempt_count: number
  // payload do GHL inteiro (jsonb); o front pode usar pra inspecionar
  payload: unknown
}

type ListDlqResponse = DlqEvent[]
```

### `POST /api/alertas/dlq/{id}/reprocess`

**Permissão:** `admin`. Body vazio. Resposta:

```ts
interface ReprocessDlqResponse {
  reprocessed: true
  raw_event_id: string
  trace_id: string
}
```

Erro `409` com `code: 'NOT_IN_DLQ'` se o evento não está mais com status DLQ.

---

## US2 — Preços

### `GET /api/precos`

**Permissão:** `admin`, `financeiro`, `recepcionista`.

```ts
interface PriceHead {
  id: string // uuid da versão "head"
  procedureId: string
  procedureTussCode: string
  planId: string
  planName: string
  amountCents: number
  validFrom: string // 'YYYY-MM-DD'
}

interface ListPricesQuery {
  procedure_id?: string
  plan_id?: string
  as_of?: string // default = hoje
}

type ListPricesResponse = PriceHead[]
```

> ⚠️ Esta resposta usa **camelCase** (saída do helper `listPriceHeads`). As
> demais usam snake_case. Quando o front mapear pra um único modelo,
> normalizar pra um lado só.

### `POST /api/precos/versions`

**Permissão:** `admin`. Body:

```ts
interface CreatePriceVersionRequest {
  procedure_id: string
  plan_id: string
  amount_cents: number
  valid_from: string // 'YYYY-MM-DD'
  reason: string // mín. 3 caracteres
  expected_head_id: string | null // null = primeira versão da chain
}

interface PriceVersion {
  id: string
  procedure_id: string
  plan_id: string
  amount_cents: number
  valid_from: string
  reason: string
  created_by: string
  previous_version_id: string | null
}

type CreatePriceVersionResponse = PriceVersion // 201
```

**409 Conflict** (chain head mudou desde o load do form OU mesmo `valid_from`
já existe):

```ts
interface PriceVersionConflictResponse {
  code: 'PRICE_VERSION_CONFLICT'
  message: string
  current_head_id: string | null // versão real do banco — recarregar form
}
```

UX recomendada: ao receber 409, abrir um modal "Outro admin alterou o preço.
Recarregue", refazer `GET /api/precos/versions/{id}/history` com o novo
`current_head_id` e reabrir o form com o valor atualizado.

### `GET /api/precos/versions/{id}/history`

```ts
interface PriceVersionWithMeta {
  id: string
  procedure_id: string
  plan_id: string
  amount_cents: number
  valid_from: string
  created_at: string // ISO timestamp
  created_by: string // uuid
  reason: string
  previous_version_id: string | null
}

type GetPriceHistoryResponse = PriceVersionWithMeta[] // ordem desc por valid_from, created_at
```

---

## US2 — Procedimentos

### Fluxo do TUSS

O catálogo TUSS é **global e pré-carregado** (uma vez por instância via
`pnpm seed:tuss`). Admin **não digita código** ao cadastrar procedimento
— usa typeahead que consulta `GET /api/tuss-codes` e escolhe da lista.

### `GET /api/tuss-codes?q=&limit=`

Busca no catálogo TUSS (códigos ativos apenas). Permissão: qualquer
papel autenticado.

```ts
interface TussSearchResult {
  code: string // ex: '10101012'
  description: string // ex: 'Consulta em consultório'
  terminologyChapter: string | null
}

interface SearchTussQuery {
  q?: string // busca livre; vazio = primeiros N
  limit?: number // 1..200, default 50
}

type SearchTussResponse = TussSearchResult[]
```

A busca é por prefixo de `code` OU substring na `description`. Sugestão
de UX: input com debounce ~250ms, dropdown mostrando `"10101012 — Consulta
em consultório"`, click salva `code` no form do procedimento.

### `GET /api/procedimentos`

```ts
interface Procedure {
  id: string
  tussCode: string
  tussDescription: string | null // resolvido do catálogo global
  displayName: string | null
  active: boolean
  createdAt: string
}

interface ListProceduresQuery {
  include_inactive?: boolean // default false
}

type ListProceduresResponse = Procedure[]
```

> Mesmo aviso de camelCase do `/api/precos`.

### `POST /api/procedimentos`

**Permissão:** `admin`.

```ts
interface CreateProcedureRequest {
  tuss_code: string
  display_name?: string | null
}

interface ProcedureCreatedResponse {
  id: string
  tuss_code: string
  display_name: string | null
  active: boolean
  created_at: string
}
```

Erros:

- `400` `code: 'TUSS_CODE_INVALID'` — código não existe no catálogo ou está
  retirado (`meta.code` traz o código que falhou).
- `409` `code: 'PROCEDURE_DUPLICATE'` — já existe procedimento com esse TUSS
  no tenant.

### `PATCH /api/procedimentos/{id}`

**Permissão:** `admin`.

```ts
interface UpdateProcedureRequest {
  display_name?: string | null
  active?: boolean
}

interface UpdateProcedureResponse {
  id: string
  display_name: string | null
  active: boolean
}
```

---

## US2 — Planos de saúde

### `GET /api/planos`

```ts
interface HealthPlan {
  id: string
  name: string
  active: boolean
  createdAt: string
}

interface ListPlansQuery {
  include_inactive?: boolean
}

type ListPlansResponse = HealthPlan[]
```

### `POST /api/planos`

**Permissão:** `admin`.

```ts
interface CreatePlanRequest {
  name: string // mínimo 1 caractere
}

interface CreatePlanResponse {
  id: string
  name: string
  active: boolean
  created_at: string
}
```

Erro `409` `code: 'HEALTH_PLAN_DUPLICATE'` quando já existe plano com esse
nome.

### `PATCH /api/planos/{id}`

**Permissão:** `admin`. **Renomear é proibido por design** — só `active`.

```ts
interface UpdatePlanRequest {
  active: boolean
}

interface UpdatePlanResponse {
  id: string
  name: string
  active: boolean
}
```

---

## US2 — Auditoria

### `GET /api/auditoria`

**Permissão:** `admin`. Paginação por cursor (timestamp_utc decrescente).

```ts
type AuditResult = 'success' | 'denied' | 'conflict'

interface AuditRow {
  id: string
  tenant_id: string
  actor_id: string | null
  actor_label: string | null
  timestamp_utc: string
  entity: string // ex: 'price_versions', 'appointments', 'procedures'
  entity_id: string | null
  field: string | null
  old_value: string | null
  new_value: string | null
  reason: string | null
  ip: string | null
  user_agent: string | null
  result: AuditResult
}

interface ListAuditQuery {
  entity?: string
  from?: string // ISO timestamp
  to?: string
  result?: AuditResult
  cursor?: string | null // passar o `next_cursor` da página anterior
  limit?: number // 1..500, default 100
}

interface ListAuditResponse {
  entries: AuditRow[]
  next_cursor: string | null // null quando não há mais páginas
}
```

### `GET /api/auditoria/export`

**Permissão:** `admin`. Streaming de arquivo. Sempre retorna **todos** os
campos sem transformação (FR-019).

```ts
interface ExportAuditQuery {
  format: 'csv' | 'json' // obrigatório
  entity?: string
  from?: string
  to?: string
  result?: AuditResult
}

// Resposta:
// - format=csv  → text/csv,    download "auditoria-YYYY-MM-DD.csv"
// - format=json → application/json (array de AuditRow), download
//                 "auditoria-YYYY-MM-DD.json"
```

UX: usar `<a href="/api/auditoria/export?format=csv&...">` direto — o
browser resolve o download por causa do `Content-Disposition`.

---

## Endpoints públicos (sem auth de usuário)

Não precisam de UI, mas o front pode usar pra demos / debugging:

- `POST /api/webhooks/ghl` — assinado com HMAC SHA-256 de `${timestamp}.${rawBody}`
  usando o `webhook_secret` do tenant. Ver `scripts/simulate-ghl-webhook.ts`.
- `POST /api/workers/process-ghl-event` — chamado pelo QStash; valida a
  assinatura do Upstash.

---

## Telas a construir (mapeamento sugerido)

### `/atendimentos` (T093 — JÁ FEITO COMO MOCK)

- `GET /api/atendimentos?from=&to=&status=`
- Linha clicável → `/atendimentos/{id}`
- Filtros: data inicial, data final, status (ativo/estornado/todos)

### `/atendimentos/{id}` (T094 — MOCK FEITO)

- `GET /api/atendimentos/{id}` (devolve appointment + audit)
- Botão "Reverter" visível só se `session.role` ∈ {admin, financeiro}
  e `appointment.effective_status === 'ativo'`
- Form de reversão posta `POST /api/atendimentos/{id}/reversal`
  - Tratar 409 `APPOINTMENT_ALREADY_REVERSED` mostrando "Já foi revertido"
  - Após sucesso, refresh da página

### `/alertas` (T095 — MOCK FEITO)

- `GET /api/alertas?status=`
- Filtros: status (aberto/resolvido/todos), tipo opcional
- Botão "Resolver" só admin → `POST /api/alertas/{id}/resolve`

### `/dlq` (T096 — MOCK FEITO)

- `GET /api/alertas/dlq`
- Mostrar `failure_reason` em destaque, `payload` resumido (`event_id`,
  `event_type`, `contact.id`)
- Botão "Reprocessar" só admin → `POST /api/alertas/dlq/{id}/reprocess`

### `/precos` (T114)

- `GET /api/precos?procedure_id=&plan_id=&as_of=`
- Filtros: procedimento (dropdown carregado de `GET /api/procedimentos`),
  plano (dropdown carregado de `GET /api/planos`), data de referência
- Coluna "Vigente desde" usa `valid_from`
- Botão "Novo preço" → `/precos/novo`
- Linha clicável → `/precos/{id}` (passa o `head.id`)

### `/precos/{id}` (T115)

- `GET /api/precos/versions/{id}/history`
- Painel superior: head atual (primeiro item da lista)
- Form "Editar" carrega `expected_head_id = head.id` num campo escondido
- Submit → `POST /api/precos/versions`
  - Em 409 `PRICE_VERSION_CONFLICT`, exibir modal:
    "Outro admin alterou desde que você abriu o form. O preço atual é
    R$ XX,XX. Recarregar?" com botão que refaz o GET
- Tabela inferior: histórico completo (chain) com `valid_from`,
  `amount_cents`, `reason`, `created_at`, `created_by`

### `/precos/novo` (T116)

- Dropdowns de procedimento e plano (carregados como acima)
- Campos `amount_cents`, `valid_from`, `reason`
- Submit → `POST /api/precos/versions` com `expected_head_id: null`
  - Se a combinação já tem versões, devolve 409 `PRICE_VERSION_CONFLICT`
    com `current_head_id`. Tratar como "Use a tela de edição".

### `/procedimentos` (T166)

- `GET /api/procedimentos?include_inactive=...`
- Filtro: incluir inativos
- Form de criação inline (admin-only) → `POST /api/procedimentos`
  - Tratar 400 `TUSS_CODE_INVALID` mostrando "Código TUSS inválido ou retirado"
  - Tratar 409 `PROCEDURE_DUPLICATE` mostrando "Já existe procedimento com esse TUSS"
- Toggle "Ativo" por linha (admin-only) → `PATCH /api/procedimentos/{id}`
- Recepcionista enxerga read-only (sem botões/inputs de edição)

### `/planos` (T167)

- `GET /api/planos?include_inactive=...`
- Form de criação (admin-only) → `POST /api/planos`
  - 409 `HEALTH_PLAN_DUPLICATE` → "Já existe plano com esse nome"
- Toggle "Ativo" → `PATCH /api/planos/{id}`
- Recepcionista read-only

### `/auditoria` (T170)

- `GET /api/auditoria?entity=&from=&to=&result=&cursor=&limit=`
- Tabela paginada (button "Carregar mais" usa `next_cursor`)
- Filtros: entidade (dropdown fixo: `price_versions`, `procedures`,
  `health_plans`, `appointments`, `appointment_reversals`, `patients`,
  `doctor_commission_history`), período, resultado
- Botões "Exportar CSV" e "Exportar JSON" como `<a href>` direto pra
  `/api/auditoria/export?format=...&...` (pega filtros vigentes)

---

## Login

`POST` direto via `@supabase/supabase-js` (cliente browser):

```ts
import { createSupabaseBrowserClient } from '@/lib/db/supabase-browser'

const supabase = createSupabaseBrowserClient()
const { data, error } = await supabase.auth.signInWithPassword({
  email: 'admin@clinica-demo.test',
  password: 'demo1234',
})
```

Após sucesso, o middleware (`src/middleware.ts`) rota qualquer request a
páginas `/dashboard` (e similares) renova o cookie de sessão. Em qualquer
Server Component:

```ts
import { getSession } from '@/lib/auth/get-session'

const session = await getSession()
if (!session) redirect('/login')
```

---

## Observações para o construtor

- **camelCase vs snake_case na resposta**: alguns endpoints (preços e
  procedimentos GET) devolvem camelCase porque saem direto do helper de
  domínio; outros devolvem snake_case porque o handler reformata. Isso é
  inconsistência conhecida — o front pode normalizar com um adapter por
  endpoint. (Vamos uniformizar antes do release final.)
- **Idiomas**: textos visíveis pro usuário em pt-BR. Códigos internos
  (`tuss_code`, `effective_status`, `result`, etc.) ficam em inglês.
- **Moeda**: `Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })`
  pra formatar centavos.
- **Comissão**: `(bps / 100).toFixed(2) + '%'` pra exibir.
- **Estilo**: nada definido ainda. As páginas mock no repo usam inline
  styles tailwind-like só como placeholder; podem reescrever com qualquer
  framework de UI (Tailwind, MUI, Chakra…).
