# Contract — Sessão do Paciente (cookie HMAC) + Login Verify

## Cookie de sessão (stateless, assinado)

- **Nome**: `clinni-patient-session` · **Flags**: `HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=1800` (~30 min).
- **Formato**: `<payloadBase64Url>.<hmacSha256Hex>` (mesmo esquema de `oauth/state.ts`).
- **Payload**: `{ patientId: UUID, tenantId: UUID, iatMs: number, expMs: number }`.
- **Assinatura**: HMAC-SHA256 com segredo de servidor (`PATIENT_SESSION_SECRET`, env dedicado). Verificação com `crypto.timingSafeEqual`.
- **Verificação por request**: assinatura válida **E** `now < expMs`. Inválido/expirado → tratar como não autenticado (401). Sem hit de banco.
- **Escopo**: o cookie é a **única** fonte de `patientId`/`tenantId` nos endpoints do portal.

## RPC de login (server-side)

```
patient_portal_verify_login(p_slug TEXT, p_cpf TEXT, p_birthdate TEXT, p_key TEXT)
  RETURNS TABLE (patient_id UUID, tenant_id UUID, full_name TEXT)   -- vazio se não casar
```

- `SECURITY DEFINER`, grant só `service_role`. Resolve clínica por slug; acha paciente por CPF (decifra); confere nascimento (só dígitos); exclui anonimizado.
- O caller (`/api/paciente/login`) trata vazio como falha **genérica** e nunca diferencia "CPF não existe" de "nascimento errado".

## Invariantes de segurança (testáveis)

1. Sessão de um paciente **nunca** lê dados de outro paciente nem de outra clínica.
2. Falhas de login são indistinguíveis (mesma resposta para CPF inexistente vs. nascimento errado).
3. Após N falhas, novas tentativas são bloqueadas (rate-limit) com 429.
4. O cookie do paciente **não** concede nenhum acesso a `/api/*` de staff nem ao `(dashboard)`.
5. IP só persiste como **hash**.
