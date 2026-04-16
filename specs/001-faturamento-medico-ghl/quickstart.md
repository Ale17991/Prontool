# Quickstart — Faturamento Médico GHL/Homio

Guia rápido para subir o ambiente local e validar o fluxo ponta-a-ponta
(webhook GHL → atendimento persistido → relatório mensal).

---

## 1. Pré-requisitos

- Node.js 20 LTS (`node -v` → `v20.x`)
- pnpm 9+ (`corepack enable && corepack prepare pnpm@latest --activate`)
- Docker Desktop (para Supabase CLI local)
- Supabase CLI (`pnpm dlx supabase --version` → `1.x`)
- Conta Upstash (QStash) — crie uma Queue para dev
- Conta Resend — domínio `@dev.homio.com.br` verificado

## 2. Instalação

```bash
pnpm install
cp .env.example .env.local
```

Preencha `.env.local`:

```ini
# Supabase local (gerados pelo `supabase start`)
NEXT_PUBLIC_SUPABASE_URL=http://localhost:54321
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...
PATIENT_DATA_ENCRYPTION_KEY=<32-byte hex>

# QStash
QSTASH_URL=https://qstash.upstash.io
QSTASH_TOKEN=...
QSTASH_CURRENT_SIGNING_KEY=...
QSTASH_NEXT_SIGNING_KEY=...

# Resend
RESEND_API_KEY=...
RESEND_FROM=alertas@dev.homio.com.br

# GHL (valor exemplo; cada tenant terá seu secret em tenant_ghl_config)
GHL_DEV_WEBHOOK_SECRET=dev-shared-secret
```

## 3. Subir banco local com Supabase CLI

```bash
supabase start                          # sobe Postgres + Auth + Storage
supabase db reset                       # aplica migrations em supabase/migrations/
pnpm tsx scripts/seed-tuss.ts           # importa TUSS de charlesfgarcia/tabelas-ans
pnpm tsx supabase/seed/demo-tenant.ts   # cria tenant demo + admin + preços
```

Credenciais do tenant demo (já seedadas):
- E-mail: `admin@clinica-demo.test`
- Senha: `demo1234`
- Role: `admin`

## 4. Rodar a app

```bash
pnpm dev
# http://localhost:3000
```

Em outra aba, rode o worker da fila localmente via túnel Upstash CLI:

```bash
pnpm dlx @upstash/qstash-cli dev --url http://localhost:3000
```

Isso conecta o Upstash QStash ao seu localhost para entregar mensagens ao
worker em `/api/workers/process-ghl-event`.

## 5. Validação ponta-a-ponta (US1 — MVP)

Simule o webhook do GHL (o tenant demo tem `webhook_secret=dev-shared-secret`):

```bash
pnpm tsx scripts/simulate-ghl-webhook.ts \
  --tenant-slug clinica-demo \
  --event-id evt_0001 \
  --plano Unimed \
  --tuss 10101012 \
  --medico-id dr-silva \
  --patient-name "Maria Teste" \
  --patient-cpf "123.456.789-00" \
  --patient-email "maria@test.com" \
  --patient-phone "+5511999999999" \
  --patient-birth-date "1990-03-15"
```

Verificações:
1. `/api/webhooks/ghl` retorna 200 em <1 s com `raw_event_id`.
2. `/dashboard/atendimentos` mostra novo atendimento com valor vindo da
   tabela seed e comissão snapshot do médico.
3. Rodar o mesmo comando de novo não cria atendimento duplicado
   (`duplicate: true`).
4. Remover o custom field de plano no script e reenviar com
   `--event-id evt_0002` → aparece em `/dashboard/dlq` com motivo claro.

## 6. Validação de Principles do constitution

### Principle I — Append-only

```sql
-- Com psql apontando ao Supabase local, como role `authenticated`:
UPDATE appointments SET frozen_amount_cents = 99999 WHERE id = '<id>';
-- ERRO esperado: "Append-only table: appointments mutation forbidden (op=UPDATE)"
DELETE FROM price_versions WHERE id = '<id>';
-- ERRO esperado idem
```

### Principle II — Auditabilidade

Após alterar um preço via UI (criar nova versão), consulte:

```sql
SELECT actor_label, timestamp_utc, entity, field, old_value, new_value, reason
FROM audit_log
WHERE tenant_id = '<tenant_demo_id>'
ORDER BY timestamp_utc DESC LIMIT 5;
```

Deve retornar entrada correspondente à alteração, com todos os campos
preenchidos.

### Principle III — Multi-tenant

```bash
pnpm test tests/integration/tenant-isolation.spec.ts
# Todos os testes devem passar — tenant B não acessa dados do tenant A
# por nenhuma superfície (REST, webhook, relatório, export).
```

### Principle IV — TUSS

Tentar cadastrar preço com código TUSS inexistente ou descontinuado
retorna 400 com mensagem clara. Verifique via UI ou:

```bash
curl -X POST http://localhost:3000/api/precos/versions \
  -H "Authorization: Bearer <JWT admin>" \
  -H "Content-Type: application/json" \
  -d '{"procedure_id":"...","plan_id":"...","amount_cents":10000,"valid_from":"2026-05-01","reason":"teste","expected_head_id":null}'
# Se TUSS obsoleto: 400 TUSS_CODE_INVALID
```

### Principle V — RBAC

```bash
pnpm test tests/integration/rbac-matrix.spec.ts
# Matrix role × endpoint: cada role não-autorizado recebe 403;
# tentativa registrada em audit_log com result='denied'.
```

## 7. Gerar relatório mensal

Pela UI:
`/dashboard/relatorios/mensal` → escolher período → "Exportar PDF" e
"Exportar Excel". Os dois arquivos devem conter os mesmos totais
mostrados na tela (SC-006).

## 8. Tarefas comuns de desenvolvimento

```bash
pnpm lint                    # ESLint + Prettier
pnpm typecheck               # tsc --noEmit
pnpm test                    # Vitest (unit + integration)
pnpm test:e2e                # Playwright
pnpm supabase:diff           # gera nova migration a partir do schema atual
pnpm supabase:gen-types      # regenera src/lib/db/types.ts
```

## 9. Troubleshooting

- **QStash não entrega no local**: confirme que o túnel Upstash está
  rodando e `QSTASH_CURRENT_SIGNING_KEY` bate com o painel.
- **Audit log vazio após alterar preço**: verifique se o Route Handler
  executa `SET LOCAL app.actor_id = ...` antes do INSERT. Sem isso, o
  trigger grava `actor_id=null`.
- **RLS bloqueando leitura legítima**: confirme que o JWT do usuário
  contém `tenant_id` e `role` — log em `/api/_debug/jwt`.
- **`exceljs` gerando arquivo corrompido**: garanta `res.headers.set(
  'Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')`
  e use `workbook.xlsx.writeBuffer()` (não `writeFile`).

## 10. Deploy

- **Vercel**: conecte o repo; env vars em Project Settings; região `gru1`.
- **Supabase**: projeto em `sa-east-1`; migrations aplicadas via
  `supabase db push` no CI.
- **QStash**: queue de produção com callback apontando para
  `https://app.homio.com.br/api/workers/process-ghl-event`.
- **Resend**: domínio próprio verificado (DKIM/SPF); senders
  `alertas@homio.com.br`.
