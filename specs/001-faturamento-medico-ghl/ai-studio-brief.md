# Brief para o Google AI Studio — Front-end Homio Faturamento

> **Como usar:** copie ESTE arquivo inteiro e cole no prompt do Google AI
> Studio (Gemini). Ele tem todo o contexto, restrições técnicas e os
> tipos TypeScript que o front precisa consumir. Não invente endpoints,
> campos ou códigos de erro fora do que está aqui.

---

## 0. Tarefa

Construa o front-end (Next.js 14 + TypeScript + Tailwind) para um sistema
SaaS de **faturamento médico** que recebe atendimentos via webhook do
GoHighLevel (GHL/Homio), persiste com vigência histórica imutável e expõe
um dashboard pra clínicas operarem.

**Entregue 11 telas** (lista completa em §4). Cada tela consome endpoints
HTTP descritos em §5. **Não** mexa no backend, **não** invente novas
rotas; só consuma o que está documentado.

---

## 1. Stack obrigatório

- **Framework:** Next.js 14 (App Router) + React 18
- **Linguagem:** TypeScript estrito (`"strict": true`)
- **Estilo:** Tailwind CSS (configurar normalmente; o projeto ainda não
  tem Tailwind instalado — pode adicionar)
- **Auth client:** `@supabase/supabase-js` + `@supabase/ssr` (browser
  client via `createBrowserClient`)
- **Forms:** React 18 nativo (`useState`/`useTransition`); ou
  `react-hook-form` se preferir
- **Componentes:** **shadcn/ui** preferencial. Outras opções aceitas:
  Headless UI + Tailwind. Evitar libs pesadas (MUI, Chakra) que
  conflitam com o stack.

### Não pode

- Não introduzir Redux/Zustand/MobX (Server Components + props bastam pra
  esse escopo).
- Não usar SWR ou React Query (a maioria das telas é Server Component
  com fetch direto; mutações são form actions).
- Não montar JWT à mão. O Supabase client cuida.
- Não duplicar tipos: importar/copiar exatamente do §5.

---

## 2. Padrão de páginas

| Tipo                          | Quando usar                                         |
|-------------------------------|-----------------------------------------------------|
| Server Component (default)    | Listagens, detalhes — dados vêm do Supabase server  |
| `'use client'`                | Forms com estado local, botões com loading, modais  |

Cada rota fica em `src/app/(dashboard)/<nome>/page.tsx`. Mutações
(reverter atendimento, criar preço, resolver alerta etc.) ficam em
componentes `'use client'` separados (ex: `reversal-form.tsx`) que
chamam `fetch('/api/...')` e depois `router.refresh()`.

Layout compartilhado já existe em `src/app/(dashboard)/layout.tsx` —
sidebar de navegação + container principal. **Pode ignorar essa
estrutura existente e propor uma melhor**, contanto que mantenha:
- redirect pra `/login` quando não há sessão (`getSession()` retorna null)
- nav links visíveis condicionalmente conforme `rbac.can(role, action)`

---

## 3. Diretrizes de design

- **Idioma:** todo texto pra usuário final em **pt-BR**. Códigos
  internos (`tuss_code`, `effective_status`, `result`) ficam em inglês.
- **Moeda:** `Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })`.
- **Comissão (bps):** `(bps / 100).toFixed(2) + '%'`.
- **Datas:** `Intl.DateTimeFormat('pt-BR', ...)`. Timezone exibida em
  `America/Sao_Paulo` (configurar via `Intl`).
- **Tema:** clínico/profissional. Paleta sugerida: cinzas neutros
  (slate), azul institucional pra ações primárias (#2563eb), verde
  pra status "ativo" (#16a34a), vermelho pra "estornado"/"erro"
  (#b91c1c). Fonte system stack (`-apple-system, system-ui, sans-serif`).
- **Acessibilidade:** labels em todos os inputs, foco visível, `aria-*`
  em modais e tabelas. Tabelas usam `<th scope="col">`.
- **Responsivo:** desktop primeiro (1024+); mobile aceitável mas não
  prioritário pra esta iteração.
- **Vazios:** "Nenhum atendimento encontrado no período." em texto
  cinza-médio, sem ilustração.
- **Erros:** banner vermelho no topo da tela com a `error.message` que o
  backend devolveu. Pra erros 409 conhecidos (concorrência de preço,
  reversão duplicada), usar modal explicativo conforme §5.

---

## 4. Telas a entregar

| Rota                       | Status      | Endpoints consumidos                                          |
|----------------------------|-------------|---------------------------------------------------------------|
| `/login`                   | refazer     | `signInWithPassword` direto no client                         |
| `/atendimentos`            | refazer     | `GET /api/atendimentos`                                       |
| `/atendimentos/[id]`       | refazer     | `GET /api/atendimentos/[id]`, `POST .../reversal`             |
| `/alertas`                 | refazer     | `GET /api/alertas`, `POST /api/alertas/[id]/resolve`          |
| `/dlq`                     | refazer     | `GET /api/alertas/dlq`, `POST .../[id]/reprocess`             |
| `/precos`                  | nova        | `GET /api/precos` (+ `/procedimentos`, `/planos` p/ dropdowns) |
| `/precos/novo`             | nova        | `POST /api/precos/versions`                                   |
| `/precos/[id]`             | nova        | `GET .../history`, `POST .../versions`                        |
| `/procedimentos`           | nova        | `GET /api/procedimentos`, `POST`, `PATCH /[id]`               |
| `/planos`                  | nova        | `GET /api/planos`, `POST`, `PATCH /[id]`                      |
| `/auditoria`               | nova        | `GET /api/auditoria`, links de export                         |

Detalhes de UX por tela estão em §5.10.

---

## 5. Contrato HTTP e tipos

### 5.0 Convenções gerais

- Todas as rotas exigem `Authorization: Bearer <jwt>` exceto
  `/api/webhooks/*` e `/api/workers/*` (que o front nem chama).
- O Supabase browser client envia o cookie de sessão automaticamente,
  e o middleware (`src/middleware.ts`, já existente) propaga pro
  Route Handler. **Pelo lado do front você só precisa garantir que está
  logado**; não precisa anexar header manualmente.
- Resposta de erro padrão:
  ```ts
  interface ErrorResponse {
    error: {
      code: string             // 'FORBIDDEN', 'NOT_FOUND', 'INVALID_BODY', etc.
      message: string
      meta?: Record<string, unknown>
    }
  }
  ```
- Códigos HTTP comuns: 400 payload inválido, 401 sem sessão, 403 papel
  sem permissão, 404 entidade não encontrada, 409 conflito.
- Datas em ISO 8601 (`'2026-04-17T13:25:00.000Z'`); somente data em
  `'YYYY-MM-DD'`.
- Valores monetários em **centavos** (`amount_cents: number`); converter
  pra reais dividindo por 100 só na hora de exibir.
- `bps` (basis points): `4000` = 40,00%.

### 5.1 RBAC

```ts
type TenantRole = 'admin' | 'financeiro' | 'recepcionista' | 'profissional_saude'
```

| Ação                                                       | admin | financeiro | recepcionista | profissional_saude |
|------------------------------------------------------------|:-----:|:----------:|:-------------:|:------------------:|
| Ler atendimentos / preços / procedures / plans / médicos   | ✅    | ✅         | ✅            | ✅ (só atendimentos) |
| Reverter atendimento                                       | ✅    | ✅         | ❌            | ❌                  |
| Criar/alterar preço, procedimento, plano, médico           | ✅    | ❌         | ❌            | ❌                  |
| Ler/exportar auditoria                                     | ✅    | ❌         | ❌            | ❌                  |
| Ler/resolver alertas, ler/reprocessar DLQ                  | ✅    | ✅         | ❌            | ❌                  |

Quando o usuário não tem permissão, o backend devolve **403** e grava uma
linha em `audit_log`. **Esconda os botões/forms na UI** pra papéis sem
permissão (não confie só no 403).

### 5.2 Sessão

```ts
interface ActiveSession {
  userId: string
  email: string | null
  tenantId: string
  role: TenantRole
}
```

Login em `/login`:
```ts
import { createSupabaseBrowserClient } from '@/lib/db/supabase-browser'

const supabase = createSupabaseBrowserClient()
const { data, error } = await supabase.auth.signInWithPassword({ email, password })
if (!error) router.push('/atendimentos')
```

Em Server Component (qualquer `page.tsx`):
```ts
import { getSession } from '@/lib/auth/get-session'

const session = await getSession()
if (!session) redirect('/login')
// session.role pra esconder botões; session.tenantId pra escopo
```

### 5.3 Atendimentos

#### `GET /api/atendimentos`

```ts
interface AppointmentEffective {
  id: string
  appointment_at: string
  patient_id: string
  doctor_id: string
  procedure_id: string
  plan_id: string
  frozen_amount_cents: number
  frozen_commission_bps: number
  effective_status: 'ativo' | 'estornado'
  net_amount_cents: number          // 0 se estornado
  net_commission_cents: number
  reversal_id: string | null
  reversed_at: string | null
}

interface ListAppointmentsQuery {
  from?: string                     // 'YYYY-MM-DD' inclusive
  to?: string
  doctor_id?: string
  plan_id?: string
  status?: 'ativo' | 'estornado' | 'todos'
}

type ListAppointmentsResponse = AppointmentEffective[]
```

#### `GET /api/atendimentos/[id]`

```ts
interface GetAppointmentResponse {
  appointment: AppointmentEffective
  audit: AuditRow[]                 // ver §5.9
}
```

#### `POST /api/atendimentos/[id]/reversal`

**Permissão:** `admin`, `financeiro`.

```ts
interface ReverseAppointmentRequest {
  reason: string                    // mín. 3 caracteres
}

interface ReverseAppointmentResponse {
  id: string
  appointment_id: string
  reversal_amount_cents: number     // sempre negativo
  reason: string
}
```

Erros: 403 (papel), 404 (não encontrado), 409 `APPOINTMENT_ALREADY_REVERSED`.

### 5.4 Alertas

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
  detail: Record<string, unknown>          // chaves variam por tipo
  subject_ref: Record<string, unknown> | null
  email_sent_to: string[]
  email_last_sent_at: string | null
  resolved_at: string | null
  resolved_by: string | null
  created_at: string
}
```

#### `GET /api/alertas?status=&type=`

```ts
interface ListAlertsQuery {
  status?: 'aberto' | 'resolvido' | 'todos'
  type?: AlertType
}
type ListAlertsResponse = Alert[]
```

#### `POST /api/alertas/[id]/resolve`

**Permissão:** `admin`. Body opcional `{ note?: string }`.

```ts
interface ResolveAlertResponse {
  id: string
  status: 'resolvido'
  resolved_at: string
  resolved_by: string
}
```

### 5.5 DLQ (Dead Letter Queue)

#### `GET /api/alertas/dlq`

**Permissão:** `admin`, `financeiro`.

```ts
interface DlqEvent {
  id: string
  ghl_event_id: string
  received_at: string
  failure_reason: string | null
  processing_attempt_count: number
  payload: unknown                         // payload do GHL inteiro
}

type ListDlqResponse = DlqEvent[]
```

#### `POST /api/alertas/dlq/[id]/reprocess`

**Permissão:** `admin`. Body vazio.

```ts
interface ReprocessDlqResponse {
  reprocessed: true
  raw_event_id: string
  trace_id: string
}
```

Erro 409 `code: 'NOT_IN_DLQ'` se já saiu da fila.

### 5.6 Preços

#### `GET /api/precos?procedure_id=&plan_id=&as_of=`

**Permissão:** `admin`, `financeiro`, `recepcionista`.

```ts
interface PriceHead {
  id: string
  procedureId: string                      // ⚠ camelCase aqui
  procedureTussCode: string
  planId: string
  planName: string
  amountCents: number
  validFrom: string                        // 'YYYY-MM-DD'
}

interface ListPricesQuery {
  procedure_id?: string
  plan_id?: string
  as_of?: string                           // default = hoje
}

type ListPricesResponse = PriceHead[]
```

#### `POST /api/precos/versions`

**Permissão:** `admin`. Concorrência otimista via `expected_head_id`.

```ts
interface CreatePriceVersionRequest {
  procedure_id: string
  plan_id: string
  amount_cents: number
  valid_from: string                       // 'YYYY-MM-DD'
  reason: string                           // mín. 3 caracteres
  expected_head_id: string | null          // null = primeira versão
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

type CreatePriceVersionResponse = PriceVersion   // 201
```

**409 Conflict** (chain head mudou OU mesmo `valid_from` já existe):
```ts
interface PriceVersionConflictResponse {
  code: 'PRICE_VERSION_CONFLICT'
  message: string
  current_head_id: string | null
}
```

**UX obrigatória:** ao receber 409, abrir um **modal**:
> "Outro administrador alterou este preço enquanto você editava. O valor
> atual no banco é R$ X,XX (vigente desde DD/MM/AAAA). Recarregar?"

Botão "Recarregar" deve refazer `GET /api/precos/versions/{current_head_id}/history`
e reabrir o form com o head novo.

#### `GET /api/precos/versions/[id]/history`

```ts
interface PriceVersionWithMeta {
  id: string
  procedure_id: string
  plan_id: string
  amount_cents: number
  valid_from: string
  created_at: string
  created_by: string
  reason: string
  previous_version_id: string | null
}

type GetPriceHistoryResponse = PriceVersionWithMeta[]
// Ordem: valid_from DESC, created_at DESC. Primeiro item = head.
```

### 5.7 Procedimentos

> **Como o admin escolhe o TUSS:** o catálogo TUSS (~7000 códigos) é
> **global e pré-carregado** uma vez por instância via
> `pnpm seed:tuss` (puxa do `github.com/charlesfgarcia/tabelas-ans`). O
> admin **não decora código** — a tela de criação de procedimento usa
> um campo de busca (typeahead) que consulta `GET /api/tuss-codes`,
> mostra `code + description`, e o usuário escolhe um item da lista. O
> `tuss_code` selecionado vai pra `POST /api/procedimentos`. O backend
> valida via trigger que o código existe e está vigente.
>
> **Em desenvolvimento** o catálogo pode ter só os códigos de demo
> (~3 entradas seedadas). Pra ter o catálogo completo na demo, rodar
> `pnpm seed:tuss`.

#### `GET /api/tuss-codes?q=&limit=`

**Permissão:** qualquer papel autenticado (catálogo é leitura pública
dentro do tenant). Busca por prefixo de `code` OU substring na
`description`. Apenas códigos ativos (não retirados) são retornados.

```ts
interface TussSearchResult {
  code: string                              // ex: '10101012'
  description: string                       // ex: 'Consulta em consultório'
  terminologyChapter: string | null         // capítulo da tabela TUSS, opcional
}

interface SearchTussQuery {
  q?: string                                // busca livre (vazio = primeiros N)
  limit?: number                            // 1..200, default 50
}

type SearchTussResponse = TussSearchResult[]
```

**UX recomendada do typeahead:**
- Input com debounce de ~250ms; cada keystroke (≥2 caracteres) dispara
  `GET /api/tuss-codes?q=<texto>`.
- Lista dropdown mostra `code — description` (ex: `10101012 — Consulta
  em consultório`).
- Quando o usuário clica num item, salva o `code` no estado do form e
  exibe o `description` num campo read-only do lado.
- Estado vazio: "Digite código ou descrição para buscar."

#### `GET /api/procedimentos?include_inactive=...`

```ts
interface Procedure {
  id: string
  tussCode: string                         // ⚠ camelCase
  tussDescription: string | null           // resolvido do catálogo TUSS
  displayName: string | null
  active: boolean
  createdAt: string
}

type ListProceduresResponse = Procedure[]
```

#### `POST /api/procedimentos`

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
- 400 `TUSS_CODE_INVALID` — código não existe no catálogo ou retirado
  (mensagem: "Código TUSS inválido ou descontinuado")
- 409 `PROCEDURE_DUPLICATE` — já existe procedimento com esse TUSS no
  tenant ("Já existe procedimento com esse TUSS")

#### `PATCH /api/procedimentos/[id]`

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

### 5.8 Planos de saúde

#### `GET /api/planos?include_inactive=...`

```ts
interface HealthPlan {
  id: string
  name: string
  active: boolean
  createdAt: string                        // ⚠ camelCase
}

type ListPlansResponse = HealthPlan[]
```

#### `POST /api/planos`

**Permissão:** `admin`.

```ts
interface CreatePlanRequest {
  name: string                             // mín. 1 caractere
}

interface CreatePlanResponse {
  id: string
  name: string
  active: boolean
  created_at: string
}
```

Erro 409 `HEALTH_PLAN_DUPLICATE` ("Já existe plano com esse nome").

#### `PATCH /api/planos/[id]`

**Permissão:** `admin`. **Renomear é proibido por design** (preserva
integridade de relatórios históricos). Apenas `active` pode ser alterado.

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

### 5.9 Auditoria

```ts
type AuditResult = 'success' | 'denied' | 'conflict'

interface AuditRow {
  id: string
  tenant_id: string
  actor_id: string | null
  actor_label: string | null
  timestamp_utc: string
  entity: string                           // 'price_versions', 'procedures', etc.
  entity_id: string | null
  field: string | null
  old_value: string | null
  new_value: string | null
  reason: string | null
  ip: string | null
  user_agent: string | null
  result: AuditResult
}
```

#### `GET /api/auditoria?entity=&from=&to=&result=&cursor=&limit=`

**Permissão:** `admin`. Cursor = `timestamp_utc` decrescente.

```ts
interface ListAuditResponse {
  entries: AuditRow[]
  next_cursor: string | null               // null quando acabou
}
```

#### `GET /api/auditoria/export?format=csv|json&...`

**Permissão:** `admin`. Streaming de arquivo com **todos** os campos
(FR-019). UI: usar `<a href="/api/auditoria/export?format=csv&...">` —
o browser baixa por causa do `Content-Disposition`.

### 5.10 Mapeamento tela → endpoint

| Tela              | Endpoints                                                              | Notas de UX |
|-------------------|------------------------------------------------------------------------|-------------|
| `/atendimentos`   | `GET /api/atendimentos?from=&to=&status=`                              | Linha clicável → `/atendimentos/[id]`. Pill de status colorido. |
| `/atendimentos/[id]` | `GET /api/atendimentos/[id]`, `POST .../reversal`                  | Botão "Reverter" só admin/financeiro **e** quando `effective_status === 'ativo'`. Modal de confirmação com campo `reason`. |
| `/alertas`        | `GET /api/alertas?status=&type=`, `POST /api/alertas/[id]/resolve`     | Default filter `status=aberto`. Botão "Resolver" inline (admin). |
| `/dlq`            | `GET /api/alertas/dlq`, `POST .../reprocess`                           | `failure_reason` em destaque. Resumo do payload (event_id, type, contact.id). Botão "Reprocessar" admin. |
| `/precos`         | `GET /api/precos`, `GET /api/procedimentos`, `GET /api/planos`         | Filtros: dropdowns de procedimento e plano + datepicker `as_of`. Botão "+ Novo preço". Linha clicável → `/precos/[id]`. |
| `/precos/novo`    | `GET /api/procedimentos`, `GET /api/planos`, `POST /api/precos/versions` | Form simples; `expected_head_id: null`. 409 → "Já existe — use a tela de edição". |
| `/precos/[id]`    | `GET /api/precos/versions/[id]/history`, `POST /api/precos/versions`   | Card head no topo, form de edição abaixo (carrega `expected_head_id` escondido), tabela de histórico no rodapé. **409 = modal de conflito**. |
| `/procedimentos`  | `GET/POST /api/procedimentos`, `PATCH /api/procedimentos/[id]`, `GET /api/tuss-codes` | Toggle "Ativo" inline (admin). **Form de criação usa typeahead** que busca em `/api/tuss-codes` — admin escolhe da lista, NÃO digita código. Recepcionista vê read-only. |
| `/planos`         | `GET/POST /api/planos`, `PATCH /api/planos/[id]`                       | Idem procedimentos. **Não exibir campo de "Renomear"** — proibido. |
| `/auditoria`      | `GET /api/auditoria`, `GET /api/auditoria/export`                      | Tabela paginada com "Carregar mais". Filtros: entidade (dropdown fixo), período, resultado. Botões "Exportar CSV" e "Exportar JSON" (`<a href>` direto). |
| `/login`          | `signInWithPassword` no client                                         | Email + senha. Sucesso → push para `/atendimentos`. |

---

## 6. O que entregar

Estrutura sugerida (qualquer organização equivalente serve, contanto que
o front rode `next dev`):

```
src/
  app/
    layout.tsx                           # root, html lang="pt-BR"
    globals.css                          # tailwind base
    (auth)/
      login/page.tsx
    (dashboard)/
      layout.tsx                         # sidebar + container
      atendimentos/
        page.tsx
        [id]/
          page.tsx
          reversal-form.tsx              # 'use client'
      alertas/
        page.tsx
        resolve-button.tsx               # 'use client'
      dlq/
        page.tsx
        reprocess-button.tsx
      precos/
        page.tsx
        novo/page.tsx
        [id]/
          page.tsx
          edit-form.tsx                  # 'use client', com modal 409
      procedimentos/
        page.tsx
        toggle.tsx                       # 'use client'
        create-form.tsx                  # 'use client'
      planos/
        page.tsx
        toggle.tsx
        create-form.tsx
      auditoria/
        page.tsx
        export-buttons.tsx               # 'use client', monta querystring
  components/
    ui/                                  # se usar shadcn/ui, vai aqui
    table.tsx
    pill.tsx
    modal.tsx
    money.tsx                            # <Money cents={...} />
    bps.tsx                              # <Bps value={...} />
    date.tsx                             # <DateTime value={...} />
tailwind.config.ts
postcss.config.js
```

Helpers de fetch sugeridos (mas não obrigatórios):
- `lib/api/precos.ts`, `lib/api/procedimentos.ts`, etc. — wrappers que
  fazem `fetch` e narrow do tipo.
- `lib/format/` — utilitários de moeda/data/bps.

**Não entregar:** package.json (já existe — só me liste as deps a
adicionar). Não duplicar arquivos do backend (`lib/auth/`, `lib/db/`,
`middleware.ts` já existem; pode importá-los).

---

## 7. Como me devolver

Pode ser:

1. **Pasta `frontend-stitch/`** dentro do projeto com todos os arquivos
   gerados, OU
2. **Branch separada** `git checkout -b ui-stitch && git push origin ui-stitch`, OU
3. **Cole o código** dos componentes diretamente no chat com headers
   `=== src/app/(dashboard)/precos/page.tsx ===`.

Inclua na entrega:
- Lista de **dependências a adicionar** (ex: `tailwindcss`, `@radix-ui/react-dialog`, `lucide-react`).
- Comando inicial de **setup** se precisar (ex: `npx tailwindcss init -p`).
- **Um screenshot** ou descrição rápida de cada tela pronta (ajuda a
  validar antes de testar com dados reais).

---

## 8. Backend já está rodando

Os endpoints do §5 estão **100% funcionando** contra Supabase local
(`http://localhost:54321`). Suíte de testes: 74/74 verde. Você pode
testar contra `http://localhost:3000/api/...` enquanto desenvolve.

Login de demo (já seedado por `pnpm seed:demo`):
- E-mail: `admin@clinica-demo.test`
- Senha: `demo1234`
