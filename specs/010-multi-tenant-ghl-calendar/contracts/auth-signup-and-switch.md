# Contract — Auth: Signup + Switch Tenant

**Feature**: 010 | **Group**: signup + tenant switching

---

## `POST /api/auth/signup`

Cria conta de autenticação e autentica imediatamente. Público (sem auth prévia).

**Request body**:

```ts
{
  fullName: string,        // 1..200
  email: string,           // RFC 5322
  password: string         // ≥ 8 chars; ≥ 1 letter; ≥ 1 digit
}
```

**Server flow** (R8):

1. Valida com Zod.
2. `supabaseService.auth.admin.createUser({ email, password, email_confirm: false, user_metadata: { full_name: fullName } })`.
3. Audit `entity='auth_user', field='signup', new_value={ email }`.
4. Se sucesso → 201 com `{ ok: true }`.

**Response 201**:

```json
{ "ok": true, "userId": "uuid" }
```

**Errors**:
- `400 invalid_field` — Zod fail.
- `400 weak_password` — política mínima.
- `409 signup_failed` — mensagem genérica para e-mail duplicado e outros erros do auth.admin (FR-011 — não revela se conta existia).

**Client follow-up**: chama `supabase.auth.signInWithPassword({ email, password })` e redireciona para `/onboarding`.

---

## `POST /api/auth/switch-tenant`

Troca a clínica ativa da sessão sem deslogar (R5).

**Auth**: qualquer role autenticado.

**Request body**:

```ts
{
  tenantId: string  // UUID — clínica para a qual switchar
}
```

**Server flow**:

1. `requireRole(any)` — só precisa estar autenticado.
2. Verifica via `user_tenants` que o usuário tem vínculo `status='active'` com `tenantId`. Se não → `403 not_a_member`.
3. `supabaseService.auth.admin.updateUserById(userId, { user_metadata: { active_tenant_id: tenantId } })`.
4. UPSERT em `user_active_tenant(user_id=userId, tenant_id=tenantId)`.
5. Audit `entity='session', field='tenant_switch', old_value=<previous>, new_value=<tenantId>`.
6. `200 { ok: true }`.

**Response 200**:

```json
{ "ok": true }
```

**Errors**:
- `400 invalid_tenant_id`
- `403 not_a_member`
- `404 tenant_not_found_or_disabled`

**Client follow-up** (CRÍTICO): após receber 200, fazer:

```ts
await supabase.auth.refreshSession()  // dispara o auth_hook com o novo metadata
router.push('/operacao/atendimentos')
router.refresh()                        // limpa cache de Server Components
```

Sem o `refreshSession`, o JWT antigo continua circulando até a próxima rotação natural (~1h), e a sidebar segue mostrando a clínica antiga.

---

## `GET /api/auth/me/tenants`

Lista as clínicas ativas do usuário atual. Usado pelo seletor `/selecionar-clinica` e pelo `dashboard-shell` para decidir se mostra "Trocar clínica".

**Auth**: qualquer role autenticado.

**Response 200**:

```json
{
  "tenants": [
    {
      "tenantId": "uuid",
      "name": "Clínica Sorriso",
      "slug": "clinica-sorriso",
      "logoSignedUrl": "https://..." | null,
      "role": "admin" | "financeiro" | "recepcionista" | "profissional_saude",
      "ghlConnected": true,
      "isCurrent": true,
      "lastUsedAt": "2026-05-08T12:00:00Z" | null
    }
  ]
}
```

`isCurrent` true para a clínica que está atualmente ativa na sessão (por `jwt.tenant_id`). `lastUsedAt` vem de `user_active_tenant.updated_at`.

**Errors**: `401`.

---

## Side effect: `getSession()` enrichment

A função `getSession()` em `src/lib/auth/get-session.ts` ganha um campo opcional `availableTenants` (lista resumida) populado quando chamada em rotas que precisam (sidebar, seletor). Para minimizar overhead nas demais chamadas, esse campo é populado lazy via helper `getAvailableTenants()` separado.

Não é endpoint — é detalhe interno. Documentado aqui para alinhar.
