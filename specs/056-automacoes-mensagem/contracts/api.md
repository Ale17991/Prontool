# Contratos de API — Automações de mensagem (056)

Todas as rotas ficam sob `/api/automacoes`, exigem sessão autenticada, papel **`admin`** (FR-022) e o módulo **`automacoes`** (FR-023). Escopo de tenant vem sempre da sessão, nunca do corpo.

Erros seguem o padrão do projeto: `{ "error": "CODIGO", "detail"?: "..." }`.

---

## Mensagens

### `GET /api/automacoes/mensagens`

`200` → `{ "mensagens": [{ id, name, body, active, usadaPor: number }] }`

`usadaPor` é a contagem de automações que dependem dela — é o que permite a tela avisar antes de a clínica tentar excluir.

### `POST /api/automacoes/mensagens`

```json
{ "name": "Aniversário padrão", "body": "Feliz aniversário, {{paciente}}!" }
```

- `201` → `{ "id": "..." }`
- `400 VARIAVEL_DESCONHECIDA` → `{ "detail": "{{medico}} não é uma variável válida" }`
- `409 NOME_DUPLICADO`

### `PATCH /api/automacoes/mensagens/[id]`

Campos opcionais: `name`, `body`, `active`. Mesmas validações.

### `DELETE /api/automacoes/mensagens/[id]`

- `204` quando não há automação dependente
- `409 MENSAGEM_EM_USO` → `{ "detail": "Em uso por: Aniversário, Retorno 6 meses" }` — **nomeia os gatilhos** (FR-004)

---

## Gatilhos

### `GET /api/automacoes/gatilhos`

`200` → `{ "gatilhos": [{ id, name, source, params, active }], "fontes": [...] }`

`fontes` é o catálogo do registro, com rótulo, schema de parâmetros e **os avisos de interface** — inclusive o do FR-009 nas fontes de ausência. A tela não hardcoda essa lista.

### `POST /api/automacoes/gatilhos`

```json
{
  "name": "Álcool 3x na semana",
  "source": "checklist_marcado",
  "params": { "itemId": "alcool", "vezes": 3 }
}
```

- `201` → `{ "id": "..." }`
- `400 FONTE_DESCONHECIDA`
- `400 PARAMETROS_INVALIDOS` → `{ "detail": "vezes deve estar entre 1 e 7" }`

### `PATCH` / `DELETE /api/automacoes/gatilhos/[id]`

`DELETE` remove em cascata as automações que usam o gatilho — diferente da mensagem, que é recusada. A assimetria é proposital: o gatilho **é** a automação do ponto de vista da clínica; a mensagem é insumo compartilhado.

### `GET /api/automacoes/gatilhos/[id]/previa`

`200` →

```json
{
  "candidatosHoje": 137,
  "tetoPorCiclo": 50,
  "avisoVolume": true,
  "exemplos": ["Maria S.", "João P."]
}
```

FR-014. Roda a **mesma** enumeração do motor, sem gravar (research D6). `avisoVolume` fica `true` quando os candidatos excedem o teto por ciclo — é o sinal de que ativar vai levar vários dias para vazar a fila.

---

## Automações

### `GET /api/automacoes`

`200` → `{ "automacoes": [{ id, gatilho, mensagem, active, ultimaExecucao, enviados30d, lidos30d }] }`

`enviados30d`/`lidos30d` são **derivados** do registro de ocorrências e dos eventos de entrega a cada leitura, nunca contadores gravados (FR-020). Corrigir a regra reapura o histórico — mesmo princípio do SC-004 da 051.

### `POST /api/automacoes`

```json
{ "triggerId": "...", "messageTemplateId": "..." }
```

- `201` → `{ "id": "...", "active": false }` — **nasce desligada**
- `400 VARIAVEL_NAO_FORNECIDA` → `{ "detail": "A mensagem usa {{procedimento}}, que o gatilho de aniversário não fornece" }` (FR-005, validado na associação — research D7)
- `409 JA_EXISTE`

### `PATCH /api/automacoes/[id]`

```json
{ "active": true }
```

`200`. Ativar e desativar são auditados com ator (FR-018).

---

## Ciclo de execução

Não há rota nova. A avaliação acontece dentro de `/api/cron/send-reminders` (research D1), que passa a responder também os contadores de automação:

```json
{
  "processed": 12,
  "sent": 10,
  "failed": 0,
  "skipped": 2,
  "automacoes": { "avaliadas": 4, "enviadas": 7, "suprimidas": 3, "impedidas": 12 }
}
```

**Os dois blocos são independentes**: falha na avaliação de automações não impede o envio de lembretes, e vice-versa. Cada um em `try/catch` próprio, com o erro registrado e o ciclo seguindo.
