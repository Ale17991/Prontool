# Contract — `/api/atendimentos/[id]/materiais`

**Endpoints novos** introduzidos pela Feature 007. Anexar e listar materiais de um atendimento existente.

Auth: cookie de sessão Supabase. Roles permitidos: `admin`, `recepcionista`, `profissional_saude` (mesma policy de `/api/atendimentos/manual`). Toda chamada passa por `requireRole([...])` no `route.ts`.

---

## `POST /api/atendimentos/[id]/materiais`

Anexar um ou mais materiais a um atendimento já existente.

### Request

```http
POST /api/atendimentos/{id}/materiais
Content-Type: application/json
Cookie: sb-...

{
  "materiais": [
    { "tuss_code": "70000010", "tuss_description": "GAZE ESTERIL 7,5x7,5cm", "quantity": 3 },
    { "tuss_code": "70000028", "tuss_description": "SERINGA DESCARTAVEL 5ML", "quantity": 1 }
  ]
}
```

### Body schema (Zod)

```ts
const bodySchema = z.object({
  materiais: z.array(z.object({
    tuss_code: z.string().min(1).max(20),
    tuss_description: z.string().min(1).max(500),
    quantity: z.number().int().positive().default(1),
  })).min(1).max(50),
})
```

`min(1)` porque enviar array vazio para um endpoint que serve para anexar é não-operação — devolve 400.

### Responses

#### `201 Created`

```json
{
  "appointment_id": "9b1f...",
  "materials": [
    {
      "id": "5c2a...",
      "tuss_code": "70000010",
      "tuss_description": "GAZE ESTERIL 7,5x7,5cm",
      "quantity": 3,
      "created_at": "2026-04-30T18:42:00Z"
    },
    {
      "id": "5c2b...",
      "tuss_code": "70000028",
      "tuss_description": "SERINGA DESCARTAVEL 5ML",
      "quantity": 1,
      "created_at": "2026-04-30T18:42:00Z"
    }
  ]
}
```

#### `400 Bad Request`

- Payload inválido (array vazio, quantity ≤ 0, tuss_code vazio)
- Código TUSS não pertence à tabela 19 ou não está vigente (rejeitado pelo trigger `check_material_tuss_table`)

```json
{ "error": { "code": "INVALID_BODY", "message": "Payload inválido", "issues": [...] } }
```

ou

```json
{ "error": { "code": "MATERIAL_TUSS_INVALID", "message": "Código TUSS não pertence à tabela de materiais ou não está vigente." } }
```

#### `401 Unauthorized` / `403 Forbidden`

Padrão do `requireRole`. Sem corpo padronizado adicional além do existente do projeto.

#### `404 Not Found`

Atendimento `id` não existe ou não pertence ao tenant.

```json
{ "error": { "code": "APPOINTMENT_NOT_FOUND", "message": "Atendimento não encontrado." } }
```

#### `409 Conflict`

Atendimento já foi cancelado (existe row em `appointment_reversals`). Não aceita novos materiais.

```json
{ "error": { "code": "APPOINTMENT_REVERSED", "message": "Atendimento já cancelado — não aceita novos materiais." } }
```

#### `500 Internal Server Error`

Erro genérico (DB indisponível, etc.). Resposta não inclui `digest`.

```json
{ "error": { "code": "INTERNAL", "message": "Algo deu errado. Tente novamente em alguns segundos." } }
```

### Side effects

- INSERT em `appointment_materials` (1 row por item).
- INSERT em `audit_log` para cada material (entity_type `appointment_material`, event_type `appointment_material.created`).
- Pino log em `info` com `tenant_id`, `actor_user_id`, `appointment_id`, `materials_count`.

### Idempotência

Não é idempotente — chamar duas vezes anexa duplicado (consistente com FR de "aceitar duplicatas"). Cliente é responsável por gerenciar deduplicação se necessário.

---

## `GET /api/atendimentos/[id]/materiais`

Listar materiais de um atendimento.

### Request

```http
GET /api/atendimentos/{id}/materiais
Cookie: sb-...
```

### Responses

#### `200 OK`

```json
{
  "materials": [
    {
      "id": "5c2a...",
      "tuss_code": "70000010",
      "tuss_description": "GAZE ESTERIL 7,5x7,5cm",
      "quantity": 3,
      "created_at": "2026-04-30T18:42:00Z",
      "created_by": "u_..."
    }
  ]
}
```

Ordenado por `created_at ASC`. Array vazio quando não há materiais.

#### `401/403/404`

Mesmas semânticas do POST.

### Performance

- Query simples: `SELECT * FROM appointment_materials WHERE appointment_id = $1 ORDER BY created_at`. Índice `appointment_materials_appointment_idx` suporta. p95 esperado < 50 ms.
- Sem cache — leitura sempre fresh (página de timeline e modal de detalhe são SSR).

---

## Implementação esperada (route.ts)

```ts
// src/app/api/atendimentos/[id]/materiais/route.ts
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireRole } from '@/lib/auth/require-role'
import { createSupabaseServerClient } from '@/lib/db/supabase-server'
import { attachMaterials, listMaterials } from '@/lib/core/appointments/materials'
import { toHttpResponse } from '@/lib/observability/http'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const bodySchema = z.object({
  materiais: z.array(z.object({
    tuss_code: z.string().min(1).max(20),
    tuss_description: z.string().min(1).max(500),
    quantity: z.number().int().positive().default(1),
  })).min(1).max(50),
})

export async function POST(
  req: Request,
  { params }: { params: { id: string } }
): Promise<Response> {
  try {
    const session = await requireRole(['admin', 'recepcionista', 'profissional_saude'], {
      entity: 'appointment_materials',
      route: `/api/atendimentos/${params.id}/materiais`,
      request: req,
    })
    const parsed = bodySchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) {
      return NextResponse.json(
        { error: { code: 'INVALID_BODY', message: 'Payload inválido', issues: parsed.error.issues } },
        { status: 400 },
      )
    }
    const supabase = await createSupabaseServerClient()
    const result = await attachMaterials(supabase, {
      appointmentId: params.id,
      materials: parsed.data.materiais,
    })
    return NextResponse.json(result, { status: 201 })
  } catch (e) {
    return toHttpResponse(e)
  }
}

export async function GET(
  req: Request,
  { params }: { params: { id: string } }
): Promise<Response> {
  try {
    await requireRole(['admin', 'recepcionista', 'profissional_saude'], {
      entity: 'appointment_materials',
      route: `/api/atendimentos/${params.id}/materiais`,
      request: req,
    })
    const supabase = await createSupabaseServerClient()
    const materials = await listMaterials(supabase, { appointmentId: params.id })
    return NextResponse.json({ materials })
  } catch (e) {
    return toHttpResponse(e)
  }
}
```

Service layer (`src/lib/core/appointments/materials/`):
- `attach.ts` — chama RPC `attach_materials_to_appointment`. Mapeia erros do RPC (`APPOINTMENT_NOT_FOUND`, `APPOINTMENT_REVERSED`, `MATERIAL_TUSS_INVALID`) para `DomainError` apropriados.
- `list.ts` — faz `SELECT` simples; retorna array tipado.

---

## Testes mínimos

- **Contract test**: tabela `appointment_materials` rejeita UPDATE/DELETE (Principle I).
- **Tenant isolation test**: usuário do tenant A não consegue listar nem anexar materiais a atendimento do tenant B (404 em ambos os casos, não 403 — não vazar existência).
- **Role test**: cada role permitido (`admin`, `recepcionista`, `profissional_saude`) consegue POST e GET; outras roles (se houver) → 403.
- **Cancelado test**: anexar material a atendimento revertido → 409.
- **TUSS guard test**: anexar com código de tabela 22 (procedimento) → 400 (`MATERIAL_TUSS_INVALID`).
- **Quantity test**: quantity=0 → 400; quantity=-1 → 400; quantity=1 → 201.
- **Read empty**: GET para atendimento sem materiais → `{ materials: [] }`.
