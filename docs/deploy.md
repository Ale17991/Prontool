# Deploy Checklist — Pronttu

Passo-a-passo para levar o projeto de zero a produção. Itens marcados
"👤 operador" precisam de um humano com acesso à conta paga (Supabase,
Vercel, Upstash, Resend, registrar DNS); os outros são automáveis ou já
estão prontos no repo.

Sequência sugerida: **Supabase → DNS/Resend → QStash → Vercel → smoke**.
Nenhum passo depende do seguinte de forma irreversível, mas resolver
Supabase primeiro desbloqueia os env vars que todo mundo precisa.

---

## 0. Pré-requisitos

- Acesso de admin nas contas: Supabase, Vercel, Upstash, Resend.
- Domínio `pronttu.io` apontável (DNS no Cloudflare/Registro.br/…).
- Repositório GitHub/GitLab com branch `main` protegida.
- Última suite local verde: `pnpm lint && pnpm typecheck && pnpm test && pnpm test:e2e`.

---

## 1. Supabase — projeto de produção (👤 operador)

1. **Criar projeto** em <https://supabase.com/dashboard>:
   - Organização: a da clínica
   - Nome: `pronttu-prod`
   - Region: **`sa-east-1`** (São Paulo — obrigatório; latência + LGPD)
   - Plano: **Pro** (RLS em escala, PITR 7d, connection pooling)
   - Postgres version: default (≥ 15)
2. **Capturar secrets** de Settings → API (guarde em gerenciador de senhas;
   não committar):
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `SUPABASE_JWT_SECRET`
3. **Link local ao projeto remoto** e aplicar migrations:
   ```bash
   pnpm dlx supabase link --project-ref <ref>
   pnpm dlx supabase db push     # aplica supabase/migrations/ em ordem
   ```
4. **Habilitar o auth hook de custom claims** (senão `tenant_id`/`role` não
   entram no JWT):
   - Dashboard → Authentication → Hooks → Custom Access Token
   - Tipo: `Postgres function`
   - Function: `public.auth_hook_custom_claims`
   - Enabled: ✅
5. **Set GUC** (encriptação de paciente via pgcrypto):
   ```sql
   -- Rodar no SQL editor do projeto prod:
   ALTER DATABASE postgres
     SET "app.patient_encryption_key" = '<hex de 64 chars — openssl rand -hex 32>';
   ```
   Guarde o mesmo valor em `PATIENT_DATA_ENCRYPTION_KEY` — tem que bater.
6. **Seed catálogo TUSS + tenant inicial** via service_role:
   ```bash
   # .env.prod.local com os secrets de prod
   pnpm dlx tsx --env-file=.env.prod.local scripts/seed-tuss.ts
   # seed demo NÃO vai para prod — crie o tenant real manualmente via SQL
   # ou endpoint de platform operator.
   ```
7. **Rodar constitution suite (T057–T060) contra o Pro** — opcional mas
   recomendado para fechar T155:
   ```bash
   SUPABASE_DB_URL="postgresql://..." \
   NEXT_PUBLIC_SUPABASE_URL="https://<ref>.supabase.co" \
   SUPABASE_SERVICE_ROLE_KEY="..." \
   pnpm test tests/integration/append-only.spec.ts \
              tests/integration/tenant-isolation.spec.ts \
              tests/integration/audit-trail.spec.ts \
              tests/integration/rbac-matrix.spec.ts
   ```
   **Importante**: essas specs chamam `test_truncate_all_mutable` — o helper
   existe na migração 0020 e foi para Pro junto com as outras, mas garanta
   que o service_role tem permissão (já concedido em `GRANT EXECUTE` na
   0020). O suite local roda em ~17 s; Pro deve dar <30 s.

## 2. DNS e Resend (👤 operador)

1. Resend → Add Domain → `pronttu.io`.
2. Copiar os 3 registros TXT/CNAME (SPF, DKIM, return-path) para o DNS.
3. Esperar verificação (~5 min). Confirmar "Verified" no dashboard.
4. Criar API key com escopo de envio e guardar em `RESEND_API_KEY`.
5. Sender: `alertas@pronttu.io` (ou subdomínio `no-reply@alerts.pronttu.io`
   se preferir separação) — preencher em `RESEND_FROM`.

Teste fumaça (antes do deploy):
```bash
curl -X POST https://api.resend.com/emails \
  -H "Authorization: Bearer $RESEND_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"from":"alertas@pronttu.io","to":["voce@pronttu.io"],"subject":"ping","text":"ok"}'
```

## 3. QStash (Upstash) (👤 operador)

1. <https://console.upstash.com> → QStash → Create Queue.
2. Region: **sa-east-1** (mesmo do Supabase, minimiza RTT no callback).
3. Retries: 5 (bate com o que `enqueueGhlEvent` pede).
4. Dead Letter: enable (QStash mantém DLQ nativo + temos `dlq_events` no DB).
5. Guardar:
   - `QSTASH_URL=https://qstash.upstash.io`
   - `QSTASH_TOKEN`
   - `QSTASH_CURRENT_SIGNING_KEY`
   - `QSTASH_NEXT_SIGNING_KEY`
6. O callback URL é computado por `enqueueGhlEvent` a partir de
   `NEXT_PUBLIC_APP_URL` + `/api/workers/process-ghl-event` — não precisa
   configurar no painel.

## 4. Vercel (👤 operador)

1. Import repo → selecionar branch `main`.
2. Framework: Next.js (auto-detectado).
3. Region: **`gru1`** (São Paulo). Pinar em Settings → Functions → Region.
4. Env vars (Production scope — replicar no Preview se quiser PR
   smoke-testing contra o mesmo Supabase Pro):

   | Var                            | Valor                                  |
   | ------------------------------ | -------------------------------------- |
   | `NEXT_PUBLIC_APP_URL`          | `https://app.pronttu.io`             |
   | `NEXT_PUBLIC_SUPABASE_URL`     | da seção 1                             |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY`| da seção 1                             |
   | `SUPABASE_SERVICE_ROLE_KEY`    | da seção 1                             |
   | `SUPABASE_JWT_SECRET`          | da seção 1                             |
   | `PATIENT_DATA_ENCRYPTION_KEY`  | hex-64 do GUC da seção 1 (**igual**)   |
   | `QSTASH_URL`                   | `https://qstash.upstash.io`            |
   | `QSTASH_TOKEN`                 | da seção 3                             |
   | `QSTASH_CURRENT_SIGNING_KEY`   | da seção 3                             |
   | `QSTASH_NEXT_SIGNING_KEY`      | da seção 3                             |
   | `RESEND_API_KEY`               | da seção 2                             |
   | `RESEND_FROM`                  | `alertas@pronttu.io`                 |
   | `PLATFORM_OPERATOR_TOKEN`      | `openssl rand -hex 32` (novo em prod)  |
   | `LOG_LEVEL`                    | `info`                                 |
   | `NEXT_PUBLIC_FEATURE_*`        | `true` para telas que vão ao ar        |

5. Domain: vincule `app.pronttu.io` (ou o subdomínio definido).
6. Deploy. Primeiro build deve passar — se não, os culpados costumam ser
   env vars faltantes (Supabase/pgcrypto).

## 5. Configurar o tenant real em produção

Depois do primeiro deploy:

1. **Criar o tenant** via SQL (Dashboard → SQL editor), com o encryption key
   já setado na sessão:
   ```sql
   INSERT INTO tenants (slug, name, status)
   VALUES ('<slug-da-clinica>', '<Nome da Clínica>', 'active')
   RETURNING id;
   ```
2. **Admin inicial**: Dashboard → Authentication → Add User → email/senha
   → após criado, inserir em `user_tenants`:
   ```sql
   INSERT INTO user_tenants (user_id, tenant_id, role)
   VALUES ('<uid>', '<tenant-id>', 'admin');
   ```
3. **tenant_ghl_config** — encriptar o webhook secret com a mesma chave que
   o app usa:
   ```sql
   SET LOCAL app.patient_encryption_key = '<mesmo hex da prod>';
   INSERT INTO tenant_ghl_config (tenant_id, webhook_secret_enc, field_map)
   VALUES (
     '<tenant-id>',
     extensions.pgp_sym_encrypt('<secret-real-do-ghl>', current_setting('app.patient_encryption_key')),
     '{"plano":"plano","tuss":"tuss","medico_id":"medico_id","patient_name":"patient_name","patient_cpf":"patient_cpf","patient_phone":"patient_phone","patient_email":"patient_email","patient_birth_date":"patient_birth_date"}'
   );
   ```
4. Plans, procedures, doctors: via UI (as telas admin já suportam) ou SQL
   seeding específico da clínica.

## 6. Smoke tests em produção

Rodar **manualmente** após o primeiro deploy, na ordem:

1. **Webhook**: disparar um evento de teste do GHL (staging pipeline). Confirmar
   que o atendimento aparece em `/atendimentos` em <5 s.
2. **Dashboard**: login como admin, conferir que cada tela carrega sem 500:
   `/atendimentos`, `/precos`, `/medicos`, `/pacientes`, `/despesas`,
   `/anamnese`, `/relatorios/mensal`, `/auditoria`, `/alertas`, `/dlq`.
3. **Append-only**: como role `authenticated` no SQL editor:
   ```sql
   UPDATE appointments SET frozen_amount_cents = 1 WHERE id = '<algum id>';
   -- deve dar erro do trigger
   ```
4. **Report export**: `/relatorios/mensal` → PDF e Excel — arquivos baixam
   e não estão vazios.
5. **Alert**: forçar um webhook com TUSS desconhecido → evento em DLQ,
   email de alerta chega em <1 min.

## 7. Runbook para quando algo rompe

Ver `docs/operations.md` para:
- Rodar manualmente um evento da DLQ (`/alertas/dlq`).
- Rotacionar `PATIENT_DATA_ENCRYPTION_KEY` (hard — requer re-encriptar).
- Revogar um token de platform operator.
- Forçar anonimização LGPD de um paciente.

## 8. Status das dependências no repo

| Item                               | Status |
| ---------------------------------- | ------ |
| Migrations 0001–0030               | ✅ verdes em local após `supabase db reset` |
| Constitution suite T057–T060       | ✅ 15/15 local (run em Pro = T155) |
| Unit + integration (120 testes)    | ✅ |
| E2E Playwright (T075/T107/T138)    | ✅ |
| SC-011 patient encryption (T150)   | ✅ |
| LGPD endpoints                     | ✅ (ver `docs/lgpd.md`) |
| Observabilidade / trace_id         | ✅ (T099) |
| Webhook perf p95 < 1 s (SC-004)    | ✅ (ver `docs/performance-report.md`) |
| TUSS license compliance            | ✅ (ver `docs/data-sources.md`) |
| Seed TUSS                          | `pnpm seed:tuss` (precisa rodar em prod) |
| Auth hook custom claims            | ⚠️ precisa habilitar manualmente no dashboard (seção 1.4) |
| Supabase Pro sa-east-1             | ⚠️ seção 1 |
| Vercel gru1                        | ⚠️ seção 4 |
| QStash sa-east-1                   | ⚠️ seção 3 |
| Resend domínio verificado          | ⚠️ seção 2 |

---

**Última revisão**: 2026-04-21 (fechamento de T155/T156/T157).
