# Contrato — serviço de WhatsApp → Clinni (confirmação de entrega)

`POST /api/webhooks/whatsapp-status`

Rota **pública** (sem sessão). Isenta de `requireRole` pelo prefixo `webhooks/` já presente em
`AUTH_EXEMPT_PREFIXES` (`scripts/check-require-role.mjs:34`) — `pnpm lint:auth` passa sem
alteração no script.

---

## Autenticação

Header `Authorization: Bearer <callback_secret>`, comparado com `crypto.timingSafeEqual`.

- Sem header, ou segredo divergente → `401`, **nada é gravado** (FR-020).
- O segredo é o `callbackSecret` devolvido no `provision-tenant`.

---

## Corpo

```jsonc
{
  "messageId": "<uuid interno do braço>",
  "externalId": "<UUID do appointment_reminders>",
  "evolutionMessageId": "<key.id>",
  "to": "5511999999999",
  "status": "delivered",
  "timestamp": "2026-07-28T12:34:56.000Z",
}
```

`status` ∈ `sent` | `delivered` | `read` | `error`.

---

## Processamento

1. Valida o Bearer. Falhou → `401`.
2. Resolve o lembrete por `externalId`. Não encontrou → `200` (confirmação de mensagem que não é
   nossa, ou de um ambiente diferente; responder 200 evita retentativa em loop).
3. Deriva `tenant_id` **do lembrete**, nunca do corpo da requisição (Princípio III).
4. `INSERT` em `whatsapp_delivery_events`. Sem `UPDATE` em `appointment_reminders` — ele já é
   terminal e imutável (D4).
5. Responde `200`.

**Idempotência**: a mesma confirmação chegando duas vezes gera duas linhas de evento. Isso é
aceitável e proposital — a tabela é um log, e a leitura resolve por precedência de rank
(`sent=1 < delivered=2 < read=3 < error=9`), não por contagem.

**LGPD**: o campo `to` (telefone do paciente) **não** é persistido nem logado. Ele chega no
payload porque o braço o envia, e é descartado.

---

## Respostas

| Status | Quando                                    |
| ------ | ----------------------------------------- |
| `200`  | processado, ou ignorado por não ser nosso |
| `401`  | Bearer ausente ou inválido                |
| `400`  | corpo não é JSON válido                   |

Nunca retornar `5xx` para uma confirmação malformada — o braço re-tentaria em loop.
