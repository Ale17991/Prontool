# Data Model — Construtor de automações de mensagem (056)

**Migration**: `0196_message_automations.sql` (última aplicada é a `0195`)

Todas as tabelas novas carregam `tenant_id UUID NOT NULL` com RLS por tenant, no padrão do projeto.

---

## `message_templates` — o catálogo de mensagens

| Coluna                      | Tipo                          | Nota                                        |
| --------------------------- | ----------------------------- | ------------------------------------------- |
| `id`                        | UUID PK                       |                                             |
| `tenant_id`                 | UUID NOT NULL → `tenants`     | RLS                                         |
| `name`                      | TEXT NOT NULL                 | nome interno, o que a clínica vê na lista   |
| `body`                      | TEXT NOT NULL                 | corpo com `{{variavel}}`, 1–1000 caracteres |
| `active`                    | BOOLEAN NOT NULL DEFAULT TRUE |                                             |
| `created_at` / `updated_at` | TIMESTAMPTZ                   |                                             |
| `created_by`                | UUID → `auth.users`           |                                             |

- `UNIQUE (tenant_id, name)` — duas mensagens com o mesmo nome tornam a lista inútil.
- **Exclusão é recusada** enquanto houver automação apontando para ela (FR-004). FK `ON DELETE RESTRICT`, com a rota traduzindo o erro em mensagem que **nomeia os gatilhos dependentes** — "não é possível excluir" sem dizer o quê obriga a clínica a caçar.

## `automation_triggers` — o gatilho

| Coluna                                     | Tipo                          | Nota                              |
| ------------------------------------------ | ----------------------------- | --------------------------------- |
| `id`                                       | UUID PK                       |                                   |
| `tenant_id`                                | UUID NOT NULL → `tenants`     |                                   |
| `name`                                     | TEXT NOT NULL                 | rótulo da clínica                 |
| `source`                                   | TEXT NOT NULL                 | chave da fonte no registro        |
| `params`                                   | JSONB NOT NULL DEFAULT `'{}'` | validado pelo schema Zod da fonte |
| `active`                                   | BOOLEAN NOT NULL DEFAULT TRUE |                                   |
| `created_at` / `updated_at` / `created_by` |                               |                                   |

- **Sem CHECK enumerando as fontes.** A lista vive no registro em código (research D3); um CHECK no banco obrigaria migration a cada fonte nova e transformaria o ponto de extensão em ponto de atrito. A validação é da aplicação.
- `params` guarda o que cada fonte pede — `{ "meses": 6 }`, `{ "itemId": "alcool", "vezes": 3 }`.

## `automations` — o vínculo que se liga e desliga

| Coluna                                     | Tipo                                                    | Nota                                                            |
| ------------------------------------------ | ------------------------------------------------------- | --------------------------------------------------------------- |
| `id`                                       | UUID PK                                                 |                                                                 |
| `tenant_id`                                | UUID NOT NULL → `tenants`                               |                                                                 |
| `trigger_id`                               | UUID NOT NULL → `automation_triggers` ON DELETE CASCADE |                                                                 |
| `message_template_id`                      | UUID NOT NULL → `message_templates` ON DELETE RESTRICT  |                                                                 |
| `active`                                   | BOOLEAN NOT NULL DEFAULT FALSE                          | **nasce desligada** — ativar é ato consciente, depois da prévia |
| `activated_at`                             | TIMESTAMPTZ NULL                                        |                                                                 |
| `created_at` / `updated_at` / `created_by` |                                                         |                                                                 |

- `UNIQUE (trigger_id, message_template_id)` — a mesma dupla duas vezes é engano, não intenção.
- **Consistência de tenant**: CHECK por trigger garantindo que gatilho e mensagem pertencem ao mesmo tenant da automação. FK sozinha não impede cruzar tenants.

## `automation_occurrences` — o registro append-only

| Coluna           | Tipo                                            | Nota                                                                                                                                                                                 |
| ---------------- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `id`             | UUID PK                                         |                                                                                                                                                                                      |
| `tenant_id`      | UUID NOT NULL → `tenants`                       |                                                                                                                                                                                      |
| `automation_id`  | UUID NOT NULL → `automations` ON DELETE CASCADE |                                                                                                                                                                                      |
| `patient_id`     | UUID NOT NULL → `patients` ON DELETE CASCADE    |                                                                                                                                                                                      |
| `occurrence_key` | TEXT NOT NULL                                   | ver research D2                                                                                                                                                                      |
| `outcome`        | TEXT NOT NULL                                   | `enviado`, `suprimido_teto_paciente`, `suprimido_teto_clinica`, `impedido_sem_consentimento`, `impedido_sem_telefone`, `impedido_variavel_ausente`, `impedido_sem_conexao`, `falhou` |
| `reason`         | TEXT NULL                                       | detalhe legível                                                                                                                                                                      |
| `reminder_id`    | UUID NULL                                       | correlação com o envio, quando houve                                                                                                                                                 |
| `created_at`     | TIMESTAMPTZ NOT NULL DEFAULT now()              |                                                                                                                                                                                      |

- **`UNIQUE (automation_id, patient_id, occurrence_key)` é o coração da feature.** É ele que faz "uma vez só" ser propriedade do banco, não do código.
- **Append-only** por trigger anti-UPDATE/DELETE, no padrão de `whatsapp_delivery_events` — com uma exceção declarada: o `outcome` pode transitar do valor provisório gravado antes da tentativa para o desfecho final. Fora desse caminho, o registro é imutável.
- **Ocorrência suprimida por teto NÃO consome a chave**: é gravada com o desfecho e a linha é removível pela reavaliação do ciclo seguinte — senão o paciente perderia a mensagem para sempre por acaso de ordenação. Implementado como `DELETE` permitido apenas para linhas com desfecho de supressão, condição no próprio trigger.

## Alterações em tabela existente

### `patients`

| Coluna               | Tipo                               | Nota                                |
| -------------------- | ---------------------------------- | ----------------------------------- |
| `automations_opt_in` | BOOLEAN NOT NULL DEFAULT **FALSE** | consentimento próprio (research D4) |

`FALSE` como default é decisão, não descuido: os opt-ins de lembrete nascem `TRUE` porque lembrete de consulta é comunicação esperada; automação não é.

### `tenant_clinic_profile`

| Coluna                           | Tipo                         | Nota                   |
| -------------------------------- | ---------------------------- | ---------------------- |
| `automation_max_per_patient_day` | SMALLINT NOT NULL DEFAULT 1  | teto por paciente/dia  |
| `automation_max_per_cycle`       | SMALLINT NOT NULL DEFAULT 50 | teto por clínica/ciclo |

---

## Leitura (sem alteração de schema)

- `habit_checklist_marks`, `patient_habit_checklists` (0189) — fontes de checklist
- `appointments`, `appointments_effective` — confirmação de agendamento e sem-retorno
- `patients` — aniversário, telefone (cifrado), status, `anonymized_at`
- `tenant_whatsapp_config` — conexão do canal
- `tenant_entitlements` — módulo `automacoes`

## Entitlements

Módulo novo **`automacoes`** em `ModuleId` e `ALL_MODULES` (`src/lib/core/entitlements/plans.ts`), com rótulo no `/admin`. O gate vale na tela **e no motor** — `reminder_channels` ensinou que estado persistido continua produzindo efeito depois de o módulo ser revogado, se o motor não checar.

## Diagrama de dependência

```
message_templates ──┐
                    ├── automations ──< automation_occurrences >── patients
automation_triggers ┘                          │
                                               └── (reminder_id) ─→ envio 051
```
