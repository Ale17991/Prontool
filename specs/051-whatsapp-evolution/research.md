# Research — Lembretes de consulta por WhatsApp (051)

**Data**: 2026-07-28
**Escopo**: decisões técnicas que a spec deixou em aberto, com o que foi verificado no código.

---

## D1 — WhatsApp **não** entra no registry de `IntegrationAdapter`

**Decisão**: não criar `src/lib/integrations/whatsapp/adapter.ts`. Criar uma cápsula própria em
`src/lib/core/whatsapp/`, com tabela dedicada `tenant_whatsapp_config`.

**Rationale**: o contrato `IntegrationAdapter` (`src/lib/integrations/types.ts:63`) é
**event-bus**: o único método obrigatório é `handleDomainEvent(ctx, event)` reagindo a
`patient.created` / `appointment.created` / `appointment.reversed`. Envio de lembrete não é
reação a evento de domínio — é uma chamada request/response disparada pelo ciclo do cron, horas
depois do agendamento ter sido criado. Forçar o encaixe produziria um adapter com
`handleDomainEvent` vazio.

Some a isso que `ProviderId` (`types.ts:6`) é uma união **fechada** de 5 valores
(`ghl | hubspot | rdstation | pipedrive | generic_webhook`) e o registry
(`registry.ts:5`) só registra `ghl` e `generic_webhook` — `email`, `queue` e `google-calendar`
existem como diretórios de client, **não** como adapters registrados. A UI genérica de
`/configuracoes/integracoes/[provider]` renderiza um formulário a partir do
`configSchema`/`credentialsSchema`; a conexão de WhatsApp é escanear um QR Code, que nenhum
formulário gerado representa.

**Precedente no próprio repo**: a decisão D1 da feature 026 (Memed) é exatamente esta —
"Memed é request/response, não event-bus — tabela dedicada em vez de reusar o provider GHL",
com `tenant_memed_config` guardando credencial cifrada. Seguimos o mesmo desenho.

**Alternativas rejeitadas**:

- Abrir `ProviderId` e registrar um adapter `whatsapp`: gera adapter mentiroso + tela de
  configuração que não serve para QR.
- Reusar `generic_webhook`: não modela conexão, estado de sessão nem número vinculado.

---

## D2 — Onde ficam as credenciais do serviço de WhatsApp

**Decisão**: `tenant_whatsapp_config.api_key_enc`, cifrada com
`enc_text_with_key(?, PATIENT_DATA_ENCRYPTION_KEY)` — mesmo padrão de `tenant_memed_config`
(migration 0110). Nunca em variável de ambiente.

**Provisionamento**: quando a clínica ativa o WhatsApp, o Clinni chama um endpoint novo do braço
(`provision-tenant`) autenticado por uma **chave mestra de plataforma**
(`WHATSAPP_SERVICE_MASTER_KEY`), recebe de volta a `api_key` daquela clínica e a guarda cifrada.
A chave mestra é segredo de plataforma (como `CRON_SECRET`), não credencial de tenant — lida
apenas em código de servidor sob `requireRole('admin')`, nunca em adapter.

**Alternativa rejeitada**: a Homio inserir o tenant à mão no braço e um super-admin colar a
`api_key` no Clinni. Zero superfície nova, mas mata o autoatendimento do FR-001 e vira gargalo
de operação já na décima clínica.

---

## D3 — Espaçamento dos envios: QStash com delay escalonado

**Decisão**: cada envio de WhatsApp é publicado no QStash com
`delay = índice × ESPACAMENTO_SEGUNDOS`, e um worker `/api/workers/send-whatsapp-reminder`
executa o envio individual.

**Rationale**: três restrições se cruzam.

1. FR-013 exige espaçar os envios (rajada = risco de bloqueio do número).
2. `processBatch` (`process-batch.ts:164`) hoje dispara `Promise.allSettled` sobre até 200 itens
   de uma vez, dentro da função da Vercel. 200 × 3s de espaçamento = 10 minutos — estoura o
   timeout da função.
3. Cron mais frequente que diário **trava todos os deploys** no plano Hobby (gotcha já
   registrado no projeto).

QStash resolve os três: já é dependência do projeto (`@upstash/qstash`, usado no fluxo GHL em
`src/lib/integrations/queue/qstash-client.ts`), aceita `delay` por mensagem, e faz retry com
backoff. Nenhuma dependência nova, nenhum cron novo.

**Fallback quando QStash não está configurado** (dev, ou `QSTASH_TOKEN` ausente): envio inline
com espaçamento reduzido e cap menor de lote, seguindo o padrão de degradação já usado em
`isQstashConfigured()`.

**Alternativas rejeitadas**: cron a cada 5 min (trava deploy); `sleep` dentro da função (estoura
timeout); `pg_cron` no Supabase (move o agendamento para fora do repo e some do controle de
deploy).

---

## D4 — Confirmação de entrega vai em tabela nova, não em `appointment_reminders`

**Decisão**: criar `whatsapp_delivery_events` (append-only, uma linha por transição de status)
em vez de acrescentar `delivered_at`/`read_at` em `appointment_reminders`.

**Rationale**: `appointment_reminders` tem um trigger anti-mutação
(`enforce_reminders_status_transition`, migration 0094) que **só** permite a transição
`queued → terminal`. Um lembrete já em `sent` não aceita mais nenhum `UPDATE` de status. Para
gravar "entregue" e depois "lida" seria preciso relaxar esse trigger — mexer numa garantia de
imutabilidade existente para acomodar feature nova é exatamente o que o Princípio I desaconselha.

A tabela de eventos é append-only por construção, preserva a ordem real das confirmações
(inclusive as fora de ordem) e a UI lê o evento de maior precedência por lembrete. O
"não regride" do FR-019 vira regra de leitura, não de escrita — mais honesto, porque o que
chegou atrasado de fato chegou.

---

## D5 — Rota de callback de status

**Decisão**: `POST /api/webhooks/whatsapp-status`, autenticada por segredo compartilhado
(`Authorization: Bearer <callback_secret>`), comparado com `timingSafeEqual`.

**Verificado**: `scripts/check-require-role.mjs:34` já isenta o prefixo `webhooks/` da exigência
de `requireRole` (`AUTH_EXEMPT_PREFIXES`). Ou seja, `pnpm lint:auth` passa sem alteração no
script — a rota é legitimamente pública e a autenticação é o segredo, não a sessão.

**FR-020** (descartar confirmação não autenticada) é atendido aqui: sem o Bearer correto, 401 e
nada é gravado.

---

## D6 — Idempotência ponta a ponta

**Decisão**: o `externalId` mandado ao braço é o **`id` do registro em
`appointment_reminders`** (UUID). O braço ganha `UNIQUE (tenant_id, external_id)` e, em conflito,
devolve a mensagem já existente em vez de enviar de novo.

**Rationale**: a idempotência do lado Clinni já existe — o índice parcial
`appointment_reminders_idempotency (appointment_id, scheduled_offset_hours, channel) WHERE
is_manual = FALSE` (0094) garante um registro por combinação. O que falta é a segunda metade:
se o Clinni conseguir inserir o registro mas a resposta do envio se perder na rede, uma
retentativa mandaria a mensagem duas vezes. Amarrar o `external_id` ao id do lembrete fecha o
ciclo e satisfaz o FR-008 e o SC-003.

---

## D7 — Endurecimento do braço `clinni-whatsapp` (pré-requisito)

Quatro correções no repo `Homio-CRM/clinni-whatsapp` que são pré-condição de mandar mensagem
para paciente real:

1. **Autenticar o `status-webhook`.** Hoje é público sem verificação de origem
   (`supabase/functions/status-webhook/index.ts`). Qualquer um que descubra a URL forja um
   `connection.update` com `state: "close"` e derruba o envio da clínica, ou forja ACKs.
   Correção: token secreto no path da URL registrada na Evolution (a Evolution não assina o
   payload), validado em tempo constante.
2. **RLS nas 4 tabelas.** `0001_init.sql` não tem `enable row level security` em lugar nenhum, e
   `tenants.api_key` está em texto plano — a chave de todas as clínicas numa tabela sem policy.
   Correção: RLS habilitado, `REVOKE` de `anon`/`authenticated`, acesso só via service-role.
3. **`UNIQUE (tenant_id, external_id)`** em `outbound_messages` (ver D6).
4. **Escopo de instância na busca do ACK.** `status-webhook/index.ts:71` procura por
   `evolution_message_id` com `.maybeSingle()` sem filtrar instância, enquanto o índice unique é
   `(instance_id, evolution_message_id)`. Duas instâncias com o mesmo `keyId` fazem o
   `maybeSingle()` retornar erro e o ACK some em silêncio. Correção: filtrar pela instância, que
   o webhook já recebe no payload.

**Fora do pré-requisito** (registrado, não bloqueia o v1): retry de callback e o incremento
não-atômico de `callback_attempts` (`status-webhook/index.ts:134`).

---

## D8 — Telefone do paciente: nada novo a coletar

**Verificado**: a RPC `get_patient_for_tenant` já devolve `phone` decifrado
(migration 0168, linha 32 do bloco de retorno) — é a **mesma** RPC que `send-one.ts:135` já
chama para pegar nome e e-mail. Nenhuma migration de dado de paciente é necessária.

`select-due.ts` precisa passar a selecionar `phone_enc` junto de `email_enc` e a expor
"tem telefone?" do mesmo jeito que já expõe "tem e-mail?" — sem trazer o claro para o buffer de
seleção (o decrypt continua só no `send-one`, conforme o comentário em `select-due.ts:148`).

---

## D9 — Normalização de telefone: portar, não reinventar

**Decisão**: portar `normalizePhone` de `supabase/functions/_shared/phone.ts` do braço para o
Clinni, com teste unitário cobrindo os casos de borda.

**Rationale**: a regra BR do 9 tem uma armadilha conhecida — nunca remover o 9 de um número de
13 dígitos, porque as faixas novas emitem 9 seguido de 0-5. O braço já acertou isso. O Clinni
precisa da mesma regra para decidir se o telefone é sequer enviável antes de gastar uma chamada.

---

## D10 — Mensagem em texto puro

**Decisão**: `render-whatsapp.ts` novo, irmão de `render-email.ts`, produzindo texto puro.

**Rationale**: `render-email.ts` produz HTML com escape XSS. WhatsApp não renderiza HTML — o
paciente receberia as tags literais. O template customizável da clínica
(`reminder_template_body`, hoje HTML) não pode ser reusado como está; o canal WhatsApp usa
template próprio, com os mesmos placeholders (`paciente`, `medico`, `procedimento`, `horario`,
`clinica`).

---

## Riscos aceitos e registrados

| Risco                                                                                                                  | Decisão                                                                                                                                                                                                                                |
| ---------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Bloqueio do número da clínica (Baileys, não-oficial)                                                                   | Aceito conscientemente em 2026-07-28. Mitigação parcial: espaçamento (D3). Sem plano B implementado no v1.                                                                                                                             |
| Evolution API compartilhada com outro produto da Homio                                                                 | Aceito. Falha lá derruba o canal aqui; o FR-012 garante que isso vire um aviso claro, não 200 falhas por paciente.                                                                                                                     |
| ~~SC-004 (leitura ≥ 3× a abertura de e-mail)~~                                                                         | **Resolvido** na clarificação de 2026-07-28: virou alvo absoluto (≥ 70% dos entregues lidos em 24h), verificável com os próprios dados da feature.                                                                                     |
| Reenvio manual no WhatsApp é vetor de irritação do paciente e de bloqueio do número, de um jeito que no e-mail não era | Aceito conscientemente (clarificação de 2026-07-28, Q5): o reenvio manual vale para WhatsApp igual ao e-mail, confiando na recepção. Mitigação: só reenvia o mesmo conteúdo templado, nunca texto livre; toda tentativa fica auditada. |
