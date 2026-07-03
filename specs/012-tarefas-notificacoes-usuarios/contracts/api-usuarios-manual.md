# Contract — `POST /api/configuracoes/usuarios/manual`

> Cobre US3 (cadastro manual de usuário com senha + vínculo opcional a profissional).
> Complementar ao fluxo de convite por email já existente (`/api/configuracoes/usuarios/convite`).

## Rota

| Método | Path                                 | Papéis | Descrição                                                                    |
| ------ | ------------------------------------ | ------ | ---------------------------------------------------------------------------- |
| POST   | `/api/configuracoes/usuarios/manual` | admin  | Cria conta com senha + vínculo ao tenant + (opcional) vínculo a profissional |

`runtime = 'nodejs'`, `dynamic = 'force-dynamic'`.

---

## POST /api/configuracoes/usuarios/manual

**Body schema (Zod)**

```ts
const manualCreateSchema = z.object({
  full_name: z.string().trim().min(1).max(200),
  email: z.string().trim().toLowerCase().email().max(320),
  password: z.string().min(8).max(72),
  phone: z.string().trim().max(40).optional().nullable(),
  role: z.enum(['admin', 'financeiro', 'recepcionista', 'profissional_saude']),
  doctor_id: z.string().uuid().nullable().optional(), // vínculo opcional
})
```

**Lógica**:

1. `requireRole(['admin'])` — apenas admin do tenant.
2. Se `doctor_id` informado: valida que pertence ao tenant E `user_id IS NULL` (não vinculado a outro login).
3. Chama `supabase.auth.admin.createUser({ email, password, email_confirm: true })` — conta já confirmada.
   - Se 422 "already exists": faz fallback via `listUsers` (mesma estratégia de `inviteTeamMember`); valida que NÃO tem `user_tenants` row ativa neste tenant.
4. INSERT em `user_tenants` (user_id, tenant_id, role, status='active').
5. (Opcional) INSERT/UPDATE em `user_profile` (full_name, phone) — best-effort.
6. (Opcional) UPDATE em `doctors` (user_id=novo) quando `doctor_id` informado.
7. INSERT em `audit_log` (`entity='user_tenants', field='manual_create', new_value=JSON{email,role,doctor_id}`).

**Response 201**

```json
{
  "user_id": "...",
  "email": "ana@example.com",
  "role": "profissional_saude",
  "linked_doctor": { "id": "uuid", "full_name": "Dra. Ana" }
}
```

**Errors**

| Status | Code                    | Quando                                              |
| ------ | ----------------------- | --------------------------------------------------- |
| 400    | `INVALID_BODY`          | Zod fail (senha < 8, email inválido, role inválida) |
| 401    | `UNAUTHENTICATED`       | sem sessão                                          |
| 403    | `FORBIDDEN`             | papel != admin                                      |
| 404    | `DOCTOR_NOT_FOUND`      | doctor_id não pertence ao tenant                    |
| 409    | `USER_ALREADY_ACTIVE`   | email já vinculado ao tenant                        |
| 409    | `DOCTOR_ALREADY_LINKED` | doctor já vinculado a outro user_id                 |

---

## Modificação de GET /api/configuracoes/usuarios

A listagem de equipe **deve** projetar:

- `linked_doctor: { id, full_name } | null` — se o `user_id` está em `doctors.user_id` do tenant
- Para `role='profissional_saude'` e `linked_doctor=null`: UI mostra aviso "Sem profissional vinculado"

Endpoint atual já existe (`listTeamMembers`); o service ganha um JOIN:

```ts
// Após carregar users do tenant, busca doctors vinculados em UM query:
const { data: doctorsLinked } = await sb
  .from('doctors')
  .select('id, full_name, user_id')
  .eq('tenant_id', tenantId)
  .in('user_id', userIds)
  .eq('active', true)

const doctorByUser = new Map(
  (doctorsLinked ?? []).map((d) => [d.user_id, { id: d.id, full_name: d.full_name }])
)

// Projetar no TeamMember:
return {
  ...,
  linkedDoctor: doctorByUser.get(r.user_id) ?? null,
}
```

E o `TeamMember` type ganha `linkedDoctor: { id: string; fullName: string } | null`.

---

## Testes de contrato exigidos

| Arquivo                                                         | Cenários                                                                                                                                    |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `tests/contract/api-usuarios-manual-rbac.spec.ts`               | financeiro/recepcionista/profissional_saude POST → 403; admin → 201                                                                         |
| `tests/contract/doctors-user-id-unique.spec.ts`                 | UPDATE doctors SET user_id=X em dois doctors do mesmo tenant → 23505 unique violation; em tenants diferentes → permitido                    |
| `tests/integration/manual-user-create-with-doctor-link.spec.ts` | Cria usuário com vínculo a doctor → doctor.user_id atualizado; tenta criar 2º usuário vinculado ao mesmo doctor → 409 DOCTOR_ALREADY_LINKED |

### Casos de integração

1. **Happy path admin**: POST com nome, email, senha, role=recepcionista, sem doctor → 201 + user pode logar imediato.
2. **Com vínculo**: POST com doctor_id válido → 201, doctors.user_id setado, audit_log row presente.
3. **Email duplicado no tenant**: POST com email já em user_tenants ativo → 409 USER_ALREADY_ACTIVE.
4. **Doctor já vinculado**: POST com doctor_id que já tem user_id → 409 DOCTOR_ALREADY_LINKED.
5. **Doctor de outro tenant**: POST com doctor_id de tenant B → 404 DOCTOR_NOT_FOUND.
6. **Senha curta**: POST com password 7 chars → 400 INVALID_BODY.
7. **Login após criação**: o usuário criado consegue autenticar com email+senha sem confirmar email (verificável via auth.signInWithPassword).
