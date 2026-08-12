# Research — Construtor de automações de mensagem (056)

Decisões tomadas antes do desenho, com o que foi descartado e por quê.

---

## D1 — Onde a avaliação roda

**Decisão**: dentro da **rota de cron que já existe** (`/api/cron/send-reminders`), depois do ciclo de lembretes, em bloco protegido próprio.

**Rationale**: o plano Hobby da Vercel limita cron a frequência diária, e um segundo cron consumiria a cota sem ganho — as duas coisas rodam no mesmo momento do dia de qualquer forma. Mais decisivo: essa rota **acabou de ser consertada e validada em produção** (em 11/08/2026 descobriu-se que o Vercel Cron invoca com `GET` e a rota só aceitava `POST`, então o ciclo nunca havia rodado sozinho). Pendurar a avaliação numa rota comprovadamente invocada vale mais que a limpeza de ter rota própria.

**Consequência obrigatória**: os dois motores **não podem se derrubar**. Falha na avaliação de automações não pode impedir o envio de lembretes, nem o contrário — cada bloco em `try/catch` próprio, com contadores separados na resposta.

**Alternativas descartadas**:
- Rota de cron própria: gasta a cota do Hobby e, pior, seria uma rota nova nunca exercitada, repetindo o risco que acabou de custar caro.
- Avaliação sob demanda (ao abrir a tela): o gatilho de aniversário não pode depender de alguém abrir o sistema naquele dia.

---

## D2 — Como "uma vez só" é garantido

**Decisão**: tabela `automation_occurrences` com **`UNIQUE (automation_id, patient_id, occurrence_key)`**, onde cada fonte define como computar a `occurrence_key`.

| Fonte | `occurrence_key` | Significa |
|---|---|---|
| aniversário | `2026-08-11` | uma vez por aniversário |
| confirmação de agendamento | id do atendimento | uma vez por atendimento |
| sem retorno há N meses | `2026-08` | uma vez por mês corrido sem retorno |
| checklist marcado N vezes | `2026-P07` (índice do período) | uma vez por período do checklist |
| checklist sem marcação há N dias | `2026-P07` | idem |

**Rationale**: idempotência **por construção**, não por disciplina de código. Reexecutar o ciclo colide no índice; um `ON CONFLICT DO NOTHING` transforma a segunda tentativa em nada. É o mesmo mecanismo que torna o marcar do checklist idempotente (`UNIQUE (checklist, item, dia)`, migration 0189) e que o serviço de WhatsApp usa para não duplicar mensagem (`UNIQUE (tenant_id, external_id)`).

**Alternativas descartadas**:
- Guardar "último disparo" na automação: não resolve para múltiplos pacientes, e uma falha no meio do lote deixaria o marcador adiantado.
- Antijoin em memória, como faz `select-due.ts`: funciona, mas depende de a consulta estar certa toda vez. O índice não depende.

**Detalhe que decide a corretude**: a ocorrência é gravada **antes** da tentativa de envio, com desfecho atualizado depois. Gravar depois abriria janela para envio duplicado se o processo morresse entre mandar e registrar — e mensagem duplicada é pior que mensagem não enviada.

---

## D3 — Como as fontes de gatilho são modeladas

**Decisão**: **registro de fontes em código** (`sources/registry.ts`), cada fonte declarando uma interface fixa:

```
enumerarCandidatos(supabase, tenantId, hoje, params) → { patientId, occurrenceKey, variaveis }[]
schemaDeParametros → ZodSchema
variaveisQueSabePreencher → string[]
rotuloEAvisos → texto de interface (inclui o aviso do FR-009)
```

Os parâmetros da clínica ficam em `automation_triggers.params JSONB`, validados pelo schema da fonte.

**Rationale**: é o padrão que o projeto já usa para integrações (`IntegrationAdapter` com `configSchema` em `src/lib/integrations/`), e resolve o FR-025: absorver o lembrete de consulta vira **um arquivo novo em `sources/`** cujo `enumerarCandidatos` delega para `selectDueAppointments`. Nem o motor nem o modelo de dados mudam.

**Alternativas descartadas**:
- Uma tabela por tipo de gatilho: cada fonte nova viraria migration, e o motor precisaria conhecer todas.
- Condições genéricas sobre qualquer campo ("construtor de queries"): poder demais para o problema, superfície de ataque grande, e nenhuma clínica pediu isso.

---

## D4 — Consentimento

**Decisão**: coluna nova `patients.automations_opt_in BOOLEAN NOT NULL DEFAULT FALSE`, **hierárquica** sob o consentimento mestre já existente (`patients.reminders_opt_in`).

**Rationale**: são finalidades distintas em LGPD — quem aceitou ser lembrado da consulta não aceitou receber cutucão sobre álcool. É a mesma hierarquia que a 051 estabeleceu entre `reminders_opt_in` (mestre, cala todos os canais) e `reminders_whatsapp_opt_in` (só consultado quando o mestre é verdadeiro).

**Default `FALSE`, e isto é deliberado**: os outros opt-ins nasceram `TRUE` porque lembrete de consulta é comunicação esperada de uma clínica onde a pessoa marcou hora. Automação não é — nasce negada e precisa ser coletada. Ligar retroativamente 700 pacientes seria fabricar consentimento.

---

## D5 — Tetos de envio

**Decisão**: dois tetos, ambos configuráveis por clínica, ambos aplicados no motor: **por paciente por dia** (padrão 1) e **por clínica por ciclo** (padrão 50).

**Rationale**: o segundo é o que impede o desastre óbvio — ativar "sem retorno há 6 meses" numa base de milhares dispara para metade dela no primeiro ciclo. O primeiro impede o desastre sutil: paciente que satisfaz três gatilhos no mesmo dia recebe três mensagens e denuncia o número. E número denunciado é o que bloqueia a instância inteira, o risco que a 051 aceitou conscientemente.

O que exceder o teto é registrado como **suprimido**, com motivo — não como falha, e não silenciosamente. Ocorrência suprimida **não** consome a chave: ela é gravada com desfecho próprio e pode ser reavaliada no ciclo seguinte, senão o paciente perderia a mensagem para sempre por acaso de ordenação.

**Ordenação determinística** dentro do ciclo (por data de criação da automação, depois por id do paciente) para que o corte do teto não seja aleatório entre execuções.

---

## D6 — A prévia antes de ativar (FR-014)

**Decisão**: `preview.ts` chama **a mesma** `enumerarCandidatos` do motor, em modo que não grava nada.

**Rationale**: se a prévia usasse consulta própria, ela divergiria do motor no primeiro ajuste de regra — e uma prévia que mente é pior que nenhuma, porque a clínica confia nela para decidir. Reusar a mesma função torna a divergência impossível por construção.

---

## D7 — Variáveis da mensagem

**Decisão**: conjunto declarado por fonte, validado **no momento de salvar** a associação gatilho↔mensagem, não no envio.

**Rationale**: erro de variável tem que aparecer para quem está montando, na tela, e não virar mensagem torta no celular do paciente três dias depois. Como cada fonte declara o que sabe preencher, o sistema consegue dizer "esta mensagem usa `{procedimento}`, que o gatilho de aniversário não fornece" no momento em que a clínica tenta ligar os dois.

**Em tempo de envio**, variável sem dado para aquele paciente **pula o envio** com motivo registrado (FR-006). Mandar "Feliz aniversário, !" é pior que não mandar.

**Reuso**: a substituição em si segue o formato `{{variavel}}` já usado por `render-whatsapp.ts`, para a clínica não aprender duas sintaxes.

---

## D8 — Canal

**Decisão**: WhatsApp apenas no v1, reusando `src/lib/core/whatsapp/` e o registro de entrega da 051.

**Rationale**: o canal de e-mail nunca enviou nada em produção (faltam `RESEND_API_KEY` e `RESEND_FROM`), e uma mensagem de e-mail exige assunto próprio, que muda o modelo do catálogo. Entregar por um canal que funciona vale mais que prever dois.

**O modelo não fecha a porta**: a mensagem guarda só corpo de texto; acrescentar assunto depois é coluna nullable.

---

## D9 — Espaçamento entre envios

**Decisão**: reusar o mecanismo da 051 (QStash com atraso crescente por clínica; sem QStash, envio inline com lote reduzido).

**Pendência herdada, e ela é real**: `QSTASH_TOKEN` e as duas signing keys **não estão configuradas em produção**. Hoje o caminho inline atende com teto de 10 envios por ciclo e 1 s de espaçamento. Com o cron finalmente disparando de verdade e automações somando volume, isso deixa de ser teórico: **configurar o QStash é pré-requisito operacional para ativar esta feature em clínica com base grande**, não item de polimento.

---

## D10 — Modelo de três tabelas para gatilho, mensagem e automação

**Decisão**: `message_templates`, `automation_triggers` e `automations` (o vínculo), em vez de colapsar tudo numa tabela só.

**Rationale**: o spec (FR-003) e o pedido do usuário são explícitos — "primeiro seleciono o gatilho, depois escolho a mensagem", com as duas pontas reaproveitáveis. Colapsar em uma tabela faria "trocar a mensagem" e "recriar o gatilho" serem a mesma operação, e a mesma mensagem em dois gatilhos viraria cópia — que é exatamente o problema que o catálogo existe para resolver.

**Custo reconhecido**: três tabelas para o que uma resolveria se o requisito fosse mais frouxo. É complexidade pedida, não inventada.
