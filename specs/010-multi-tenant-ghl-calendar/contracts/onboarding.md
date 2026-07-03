# Contract — Onboarding (Criar Primeira Clínica)

**Feature**: 010 | **Group**: onboarding

---

## `POST /api/onboarding`

Cria a primeira clínica para um usuário autenticado sem nenhum vínculo ativo, e o vincula como administrador. Atomicidade via RPC SECURITY DEFINER `create_first_tenant`.

**Auth**: qualquer usuário autenticado **sem** clínica ativa. Se já tem alguma, retorna `409 already_has_tenant`.

**Request body**:

```ts
{
  name: string,         // 1..200 — nome da clínica (display name)
  slug?: string,        // opcional — se omitido, é gerado de `name`; se colide, sufixo numérico
  cnpj?: string,        // opcional — só dígitos ou formatado
  phone?: string        // opcional
}
```

**Server flow** (R3, R7):

1. `requireRole(any)` — autenticado.
2. Bloqueia se `getAvailableTenants(userId).length > 0` → `409 already_has_tenant`.
3. Calcula `effectiveSlug`: usa o que veio no body, ou `slugify(name)`; chama `nextAvailableSlug(supabase, base)` para resolver colisão (até 100 tentativas).
4. Chama RPC: `await supabase.rpc('create_first_tenant', { p_user_id: userId, p_name: name, p_slug: effectiveSlug, p_cnpj: cnpj, p_phone: phone })`.
5. Se RPC retorna `unique_violation` (slug colidiu entre o resolve e o insert — race) → tenta novamente com sufixo+1, max 3 retries.
6. Marca `user_metadata.active_tenant_id = newTenantId` para o auth_hook pegar no próximo refresh.
7. Audit `entity='tenants', entity_id=<newId>, field='create', new_value={ name, slug }, result='success'`.

**Response 201**:

```json
{
  "tenantId": "uuid",
  "slug": "clinica-sorriso",
  "name": "Clínica Sorriso"
}
```

**Errors**:

- `400 invalid_field` — Zod fail.
- `409 already_has_tenant` — usuário já tem vínculo ativo.
- `409 slug_exhausted` — 100 sufixos tentados sem sucesso (improvável; defesa contra loop).

**Client follow-up**: após receber 201, fazer:

```ts
await supabase.auth.refreshSession() // pega o novo claim tenant_id
router.push('/operacao/atendimentos')
router.refresh()
```

---

## `GET /api/onboarding/check-slug?slug=foo`

Endpoint utilitário para validação em tempo real do slug enquanto o usuário digita.

**Auth**: qualquer autenticado.

**Response 200**:

```json
{ "slug": "foo", "available": true | false, "suggested": "foo-2" | null }
```

`suggested` é populado quando `available=false`.

**Errors**: `400 invalid_slug` quando contém caracteres inválidos (regex `^[a-z0-9][a-z0-9-]{0,59}$`).
