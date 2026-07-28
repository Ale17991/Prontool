# Contrato — Clinni → serviço de WhatsApp (braço `clinni-whatsapp`)

Base: `WHATSAPP_SERVICE_URL` (ex.: `https://<projeto>.supabase.co/functions/v1`).
Todas as chamadas partem **do servidor** do Clinni. Nenhuma parte deste contrato é exposta ao
browser.

---

## 1. Provisionar a clínica no serviço

`POST /provision-tenant`

**Novo neste feature** — não existe hoje no braço. Necessário para o autoatendimento (FR-001).

Headers: `Content-Type: application/json`, `x-master-key: <WHATSAPP_SERVICE_MASTER_KEY>`

```jsonc
{ "externalTenantId": "<uuid de tenants.id no Clinni>",
  "slug": "clinica-exemplo", "name": "Clínica Exemplo",
  "callbackUrl": "https://app.clinnipro.com.br/api/webhooks/whatsapp-status" }
```

Resposta `200`:
```jsonc
{ "apiKey": "ck_...", "slug": "clinica-exemplo", "callbackSecret": "...",
  "alreadyProvisioned": false }
```

- Idempotente por **`externalTenantId`**, não por slug: chamar de novo devolve o tenant
  existente, **sem** rotacionar a chave (rotacionar invalidaria a `api_key_enc` já gravada).
- A identidade é o uuid justamente porque o **slug é adivinhável**. Se fosse a chave da
  idempotência, a clínica X pedindo o slug da clínica Y receberia a `api_key` de Y e passaria a
  mandar mensagem pelo número de Y. Slug já pertencente a outro tenant responde `409`.
- `callbackUrl` é o único campo que a rechamada atualiza, e precisa ser `https` — ele carrega o
  `callbackSecret` como Bearer.
- `apiKey` e `callbackSecret` são gravados cifrados em `tenant_whatsapp_config` e no segredo da
  rota de callback. Nunca logados, nunca devolvidos em rota do Clinni.
- Erros: `401` (master key inválida), `409` (slug tomado por outro tenant).

---

## 2. Conectar / gerenciar o número

Todos com header `x-api-key: <api_key da clínica>` (decifrada em memória no servidor).

| Chamada | Uso no Clinni |
|---|---|
| `POST /create-instance` → `{ instance, qrCode }` | primeiro vínculo; devolve QR base64 |
| `POST /connect-instance` `{instanceName}` → `{ qrCode }` | reconectar |
| `GET /get-instances` → `{ instances: [...] }` | estado ao vivo para a tela |
| `POST /delete-instance` `{instanceName}` | desvincular |

O Clinni espelha o estado devolvido em `tenant_whatsapp_config.connection_status`. A fonte da
verdade do estado real é o braço; o espelho existe para o cron não precisar de round-trip por
lote.

---

## 3. Enviar o lembrete

`POST /send-message`

Headers: `Content-Type: application/json`, `x-api-key: <api_key da clínica>`

```jsonc
{
  "to": "5511999999999",
  "message": "Olá, Maria! Lembrete da sua consulta...",
  "externalId": "<UUID do appointment_reminders>"
}
```

- `externalId` é **obrigatório** neste uso e é o id do registro em `appointment_reminders`
  (ver D6 do research). É a chave de idempotência e a de correlação no callback.
- `mediaUrl` não é usado no v1 (lembrete é texto puro).

Resposta `200`:
```jsonc
{ "messageId": "<uuid interno do braço>", "evolutionMessageId": "<key.id>", "status": "sent" }
```

Respostas de erro e o que o Clinni faz com cada uma:

| Status | Significado | Ação no Clinni |
|---|---|---|
| `200` | enviado | lembrete → `sent`, guarda `messageId` em `provider_message_id` |
| `401` | api-key inválida/inativa | lembrete → `failed`; alerta para a clínica (config quebrada) |
| `409` | nenhuma instância conectada | lembrete → `skipped_no_connection`; **aborta o lote daquela clínica** (FR-012) |
| `502` | falha no envio | lembrete → `failed` com motivo |
| timeout | sem resposta | lembrete → `failed`; a retentativa é segura por causa do `externalId` |

**Requisito novo sobre o braço**: em conflito de `(tenant_id, external_id)`, responder `200` com
a mensagem já existente em vez de enviar de novo.

---

## 4. Espaçamento

O Clinni **não** chama `/send-message` em rajada. Cada envio é publicado no QStash com
`delay = índice × ESPACAMENTO_SEGUNDOS` e executado por
`POST /api/workers/send-whatsapp-reminder` (rota interna, autenticada por assinatura QStash,
padrão já usado em `/api/workers/process-ghl-event`).

Valor inicial sugerido: `ESPACAMENTO_SEGUNDOS = 4`, por clínica. Um lote de 50 lembretes leva
~3min e distribui a carga sem estourar timeout de função nenhuma.
