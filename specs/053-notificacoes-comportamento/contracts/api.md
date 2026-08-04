# Contrato — Rotas

Toda rota sob `/api/*` passa por `requireRole` (checado por `pnpm lint:auth`),
exceto as de worker, que autenticam por assinatura QStash.

---

## `GET /api/notificacoes-automaticas`

Lista as regras da clínica e o catálogo de famílias disponíveis.

**Permissão**: `reminders.config`. **Módulo**: `acompanhamento`.

```jsonc
{
  "families": [
    { "id": "habito_sem_registro", "label": "...", "description": "...",
      "placeholders": ["paciente","habito","dias","clinica"],
      "defaultTemplate": "...", "defaultSilenceDays": 7,
      "paramsSchema": { /* JSON Schema derivado do Zod */ } }
  ],
  "rules": [
    { "id": "uuid", "family": "habito_sem_registro",
      "params": { "itemId": "agua", "days": 3 },
      "audience": "todos_ativos", "audienceDoctorId": null,
      "channel": "preferencial", "messageTemplate": "...",
      "silenceDays": 7, "active": true,
      "stats": { "enviadas30d": 12, "ultimoDisparo": "2026-08-03" } }
  ],
  "consent": { "pacientesComAceite": 8, "pacientesAtivos": 140 }
}
```

`consent` existe para a tela poder dizer, antes de a clínica ligar a primeira
regra, que a base nasce sem aceite (research D5). Sem esse número a clínica liga
a regra, não sai nada, e conclui que está quebrado.

---

## `POST /api/notificacoes-automaticas`

Cria uma regra.

```jsonc
{ "family": "habito_sem_registro", "params": { "itemId": "agua", "days": 3 },
  "audience": "todos_ativos", "channel": "preferencial",
  "messageTemplate": "Oi {{paciente}}, ...", "silenceDays": 7 }
```

**Validações, em ordem**:

1. `family` existe no catálogo.
2. `params` valida contra o `paramsSchema` da família.
3. `messageTemplate` só usa placeholders declarados pela família — campo
   desconhecido é recusado com o nome do campo (FR: US3/cenário 2).
4. `messageTemplate` passa na lista de expressões proibidas — recusa aponta a
   frase encontrada e sugere reescrita (research D9).
5. `audienceDoctorId` coerente com `audience`.
6. `silenceDays` entre 1 e 90.

**Erros**: `400 INVALID_PARAMS` | `400 UNKNOWN_PLACEHOLDER` |
`400 FORBIDDEN_PHRASE` | `403 FORBIDDEN` | `403 MODULE_DISABLED`.

---

## `PATCH /api/notificacoes-automaticas/[id]`

Altera parâmetros, texto, canal, silêncio ou `active`. Mesmas validações.
Vale a partir do próximo ciclo (FR-006).

## `DELETE /api/notificacoes-automaticas/[id]`

**Desativa** (`active = false`), não apaga: o histórico de ocorrências
referencia a regra.

---

## `POST /api/notificacoes-automaticas/previa`

Prévia com dados de exemplo, sem gravar nada.

```jsonc
// req
{ "family": "habito_sem_registro", "messageTemplate": "Oi {{paciente}}, ..." }
// res
{ "ok": true, "preview": "Oi Maria Silva, aqui é da Clínica Exemplo. Não vimos..." }
```

Dados de exemplo são **fixos e fictícios** — nunca um paciente real. Prévia que
usa paciente real vaza dado de um paciente para quem só queria ver o texto.

---

## `GET /api/notificacoes-automaticas/ocorrencias`

Histórico (FR-026). Filtros: `ruleId`, `patientId`, `outcome`, `desde`, `ate`.
Paginado.

```jsonc
{ "items": [
    { "id": "uuid", "ruleId": "uuid", "familyLabel": "Hábito sem registro",
      "patientId": "uuid", "patientName": "Maria S.", "cycleDate": "2026-08-04",
      "outcome": "suprimida_sem_portal",
      "observed": { "dias": 5, "itens": ["agua"], "ultimoAcessoPortal": null } }
  ], "nextCursor": null }
```

Cada desfecho tem explicação em texto na UI. `suprimida_sem_portal` sem
explicação vira reclamação de suporte; com explicação, vira entendimento de que
o sistema evitou uma cobrança injusta.

---

## `POST /api/cron/patient-signals`

Ciclo diário. `Authorization: Bearer ${CRON_SECRET}`. `maxDuration = 60`.

Por clínica com o módulo ligado e ao menos uma regra ativa:

1. **Gate de módulo no motor** (research D12) — módulo revogado, pula a clínica.
2. Fora da janela horária da clínica, pula.
3. Para cada regra ativa, `family.evaluate()` → candidatos.
4. Para cada candidato, na ordem de `priority`: consentimento → contato →
   portal (D4) → silêncio → teto (D6).
5. Grava a ocorrência **com o desfecho, sempre** — inclusive quando não envia.
6. Desfecho `enviada` → enfileira no QStash com atraso crescente por clínica.

```jsonc
{ "ok": true, "tenants": 4, "avaliadas": 312,
  "enviadas": 18, "silenciadas": 240, "suprimidas": 41,
  "adiadas": 9, "semConsentimento": 4, "durationMs": 4210 }
```

Contadores por desfecho, não só total: "312 avaliadas, 18 enviadas" sem a
decomposição não diz se o motor está funcionando ou barrando tudo.

---

## `POST /api/workers/send-patient-message`

Entrega uma mensagem. Autentica por **assinatura QStash** (isenta de
`requireRole`, como `send-whatsapp-reminder`).

```jsonc
{ "tenantId": "uuid", "occurrenceId": "uuid", "patientId": "uuid",
  "channel": "whatsapp", "body": "Oi Maria, ..." }
```

**Revalida na hora do envio** (o atraso do QStash pode ser de minutos):
consentimento, status do paciente, regra ainda ativa, módulo ainda ligado.
Condição que mudou entre a decisão e a entrega cancela o envio — a decisão de
ontem não autoriza o envio de hoje.

`patient_messages.id` é o `externalId` mandado ao serviço de WhatsApp, que tem
`UNIQUE (tenant_id, external_id)`: retentativa do QStash não duplica mensagem
(FR-024, ponta a ponta).
