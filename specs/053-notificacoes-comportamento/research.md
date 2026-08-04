# Research — Notificações por comportamento do paciente (053)

Decisões técnicas tomadas antes do desenho. Cada uma registra o que foi
escolhido, por quê, e o que foi descartado.

---

## D1 — Cápsula própria, fora do registry de integrações

**Decisão**: `src/lib/core/signals/` — motor, catálogo e avaliação. Não entra em
`src/lib/integrations/` nem no registry de `IntegrationAdapter`.

**Por quê**: o contrato de `IntegrationAdapter` é event-bus (`handleDomainEvent`)
e o gatilho aqui é **ausência de evento**, que ninguém publica — só varredura
temporal detecta. O adapter ficaria com o método vazio. É exatamente o
precedente da Memed (026 D1) e do WhatsApp (051): quando a coisa é
request/response ou varredura, ela ganha cápsula e tabela próprias.

**Descartado**: publicar um `DomainEvent` novo (`patient.signal_detected`). O bus
é síncrono, in-process, dentro do request que causou o evento, e faz fan-out
para integrações externas — nenhuma dessas três características serve a um ciclo
noturno que varre o banco inteiro.

---

## D2 — O catálogo de regras é código, não tabela

**Decisão**: as famílias de regra vivem em `src/lib/core/signals/catalog.ts` —
TypeScript, versionado no git. O banco guarda apenas as **instâncias** que a
clínica ligou.

Cada família declara: o que observa, o schema Zod dos parâmetros, os campos de
preenchimento que oferece ao texto, o texto padrão, se exige atividade no portal
(D4), a data mínima observável, e a prioridade de desempate (D6).

**Por quê**: mesmo tratamento dado aos números da IN 75/2020 na 052
(`labeling/reference.ts`) e ao catálogo de analitos na 050 (`labs/catalog.ts`).
Definição de família não é configuração de clínica — é produto. Em TS ela fica
revisável em PR, coberta por teste e impossível de uma clínica corromper.

**Descartado**: tabela `signal_rule_families` com o predicado em SQL ou numa DSL.
Vira construtor livre pela porta dos fundos, que o solicitante descartou
explicitamente, e transforma cada regra nova em migração de dados em vez de PR.

---

## D3 — Tabela nova de mensagem ao paciente, sem `appointment_id`

**Decisão**: `patient_messages` — registro de comunicação enviada a um paciente
**sem vínculo com consulta**. `appointment_reminders` não é reusada nem
relaxada.

**Por quê**: `appointment_reminders.appointment_id` é `NOT NULL`, o trigger
`enforce_reminders_status_transition` (0094) fecha a máquina de status em
`queued → terminal`, e a unique de idempotência é por
`(appointment, offset, canal)`. Relaxar qualquer um dos três para acomodar
mensagem sem consulta enfraquece garantias que existiam antes desta feature e
que a 051 já se apoiou. Tabela irmã custa uma migração; relaxar custa a
garantia.

**Consequência aceita — v1 não rastreia entrega das mensagens comportamentais.**
`whatsapp_delivery_events.reminder_id` referencia `appointment_reminders`, então
confirmação de entrega/leitura não tem onde pousar para estas mensagens. O
callback resolve o tenant procurando o `externalId` em `appointment_reminders`;
um id de `patient_messages` simplesmente não é encontrado e a rota responde
`200 ignored` — **nenhuma quebra**, apenas ausência do dado. Generalizar exigiria
tornar `reminder_id` nulável, acrescentar `message_id` e um CHECK de
exclusividade, mais o lookup duplo no callback. É escopo próprio e fica de fora
da primeira entrega, documentado aqui como caminho conhecido.

---

## D4 — Ausência de registro só é sinal para quem estava lá

**Decisão**: famílias que observam registro do paciente (hábito, medição)
declaram `requiresPortalActivity: true` e passam por dois filtros:

1. **Elegibilidade**: o paciente precisa ter **ao menos um** acesso ao portal em
   toda a história (`patient_portal_access_log`). Quem nunca entrou não é
   usuário do portal, não tem como registrar, e a regra não se aplica a ele —
   não é "sumido", é outro público.
2. **Supressão**: dentro da janela avaliada, precisa haver **algum** acesso. Sem
   acesso na janela, a ocorrência é gravada como `suprimida_sem_portal` e nada
   é enviado.

O paciente suprimido é justamente quem a família de reengajamento atende (FR-010),
então ele não fica sem contato — muda o assunto da conversa.

**Por quê**: `habit_checklist_marks` não distingue "não fez" de "não abriu o app"
(decisão da 0189; desmarcar apaga a linha). Sem o filtro, a mensagem mais
provável da feature seria cobrar hábito de quem talvez o esteja cumprindo — o
erro que mais rápido queima o canal, e irreversível, porque o paciente não
esquece ter sido acusado injustamente pela clínica.

**Descartado**: inferir "não fez" da ausência e mandar assim mesmo, contando com
o texto ameno. Texto ameno não conserta premissa falsa. Também descartado:
acrescentar coluna `done BOOLEAN` na 0189 — mudaria a semântica de uma feature
entregue e obrigaria o paciente a marcar "não fiz", que é fricção que ninguém
paga.

---

## D5 — Consentimento de finalidade novo, consentimento de canal reaproveitado

**Decisão**: coluna nova `patients.outreach_opt_in BOOLEAN NOT NULL DEFAULT FALSE`.

- **Finalidade**: `outreach_opt_in` é o gate desta feature, **independente** de
  `reminders_opt_in`. Lembrete de consulta e acompanhamento entre consultas são
  finalidades distintas em LGPD.
- **Canal**: `reminders_whatsapp_opt_in` continua valendo. Ele expressa "não me
  mande WhatsApp", que é preferência de **canal**, não de finalidade — honrá-lo
  aqui é a leitura conservadora, e a conservadora é a certa quando a dúvida é
  sobre consentimento.

**Default `FALSE` para a base existente é intencional e tem custo real**: no
primeiro dia a feature entrega zero mensagem até a clínica recoletar aceite.
Herdar o aceite de lembrete seria usar consentimento dado para outra finalidade
— exatamente o que a LGPD proíbe. A tela precisa dizer isso à clínica antes de
ela ligar a primeira regra, para não parecer defeito.

**Não renomear `reminders_whatsapp_opt_in`.** O nome ficou mais estreito que o
uso, mas renomear coluna em produção é risco sem ganho funcional. Fica
registrado aqui e num comentário na coluna.

---

## D6 — Anti-spam derivado das ocorrências, não de contador

**Decisão**: nenhum contador materializado. Silêncio e teto são **consultas**
sobre `signal_occurrences`:

- **Silêncio por regra**: existe ocorrência com desfecho `enviada` para
  `(regra, paciente)` dentro de `silence_days`? Então silencia.
- **Teto global**: quantas ocorrências `enviada` o paciente teve nos últimos 7
  dias, somando todas as regras? Atingido o teto, as demais viram `adiada`.
- **Desempate determinístico** quando várias regras concorrem pelo mesmo
  paciente: prioridade fixa da família no catálogo (D2) → `created_at` da regra
  → id da regra. Nunca aleatório, nunca "a primeira que o loop encontrou".

**Por quê**: contador materializado precisa de reset, sofre corrida entre
ciclos, e mente quando alguém corrige uma ocorrência. Derivar da tabela
append-only mantém uma fonte da verdade só. É o mesmo raciocínio do status de
entrega da 051, que é regra de leitura por rank e não coluna.

**A ocorrência é gravada mesmo quando não há envio.** `adiada`, `silenciada`,
`suprimida_sem_portal`, `sem_consentimento`, `sem_contato` são desfechos tão
importantes quanto `enviada` — sem eles é impossível responder "por que meu
paciente não recebeu?", que é a primeira pergunta que a clínica faz.

---

## D7 — Ciclo diário próprio, enfileirando no QStash

**Decisão**: rota nova `/api/cron/patient-signals`, agendada **diária** no
`vercel.json`, separada de `/api/cron/send-reminders`. O ciclo apenas avalia e
**enfileira**; a entrega vai para `/api/workers/send-patient-message` via QStash
com atraso crescente por clínica.

**Por quê**: separar o ciclo de lembrete (que tem janela de 15 min amarrada a
horário de consulta) do ciclo de sinais (que raciocina em dias) evita que um
estoure o `maxDuration` do outro. O par cron-diário + QStash-com-atraso é o
padrão já validado no repo pela 051 e é o único jeito de ter granularidade fina
sob a restrição da plataforma.

**Risco a verificar no deploy**: o plano Hobby limita **quantidade** de crons,
não só frequência, e hoje existe um. Se o segundo for recusado, o fallback é o
ciclo de sinais ser chamado ao final do ciclo de lembretes — mais acoplado, mas
funcional. Decidir na hora do deploy, não antes; o código não muda, só o
`vercel.json`. Vale lembrar que cron mais frequente que diário **trava todos os
deploys silenciosamente**, então nada de "só para testar, de hora em hora".

---

## D8 — A abstração que faltava: enviar mensagem a um paciente

**Decisão**: `src/lib/core/messaging/send-to-patient.ts` — resolve contato,
consentimento, canal, e registra. Recebe paciente + texto + finalidade; devolve
desfecho classificado. Não sabe o que é consulta nem o que é regra.

Hoje esses quatro passos estão duplicados **literalmente** entre `send-one.ts` e
`send-one-whatsapp.ts` da 018/051. Esta feature extrai a peça; migrar os
lembretes para ela fica como follow-up, **fora do escopo desta entrega** — mexer
no motor de lembretes que acabou de ir para produção, no mesmo PR de uma feature
nova, é trocar duas coisas ao mesmo tempo.

**Reusa sem reescrever**: `sendText` (`whatsapp/service-client.ts`),
`sendBookingEmail` (`resend-client.ts`), `phone.ts`, `isWhatsAppConnected` /
`getDecryptedApiKey` (`whatsapp/config.ts`), RPC `get_patient_for_tenant` para
decifrar contato.

---

## D9 — FR-008: a validação é uma rede, não uma garantia

**Decisão**, em três camadas, e a honestidade sobre o limite de cada uma:

1. **Textos padrão** de todas as famílias escritos na voz "não vimos seu
   registro", revisados um a um e cobertos por teste que casa cada texto contra
   a lista de expressões proibidas. Esta camada é forte porque o conjunto é
   fechado e nosso.
2. **Texto customizado** passa por uma lista de expressões proibidas
   (`forbidden-phrases.ts`): "você não fez", "você deixou de", "você não
   cumpriu", "você falhou", "você esqueceu", "você não seguiu", "você abandonou"
   e variantes sem o pronome. Salvar com uma delas é recusado, com a frase
   apontada e uma sugestão de reescrita.
3. **Prévia obrigatória** com dados de exemplo antes de salvar — a clínica lê o
   que o paciente vai ler.

**O limite, dito com todas as letras**: uma lista de expressões não impede uma
clínica determinada de escrever acusação com outras palavras. A camada 2 pega
descuido, não má-fé. A garantia real está na camada 1, e o valor da 2 é
transformar o padrão em "escrever assim dá trabalho" — que é o que muda
comportamento em produto. Registrar isso aqui evita que alguém leia FR-008 como
promessa forte e se surpreenda depois.

**Descartado**: proibir texto customizado. A US3 existe porque tom é identidade
da clínica, e travar tudo empurraria a clínica a mandar mensagem por fora, onde
não há nem lista de expressões nem registro.

---

## D10 — Janela observável tem piso por paciente

**Decisão**: cada família declara como calcular a **data mínima observável** de
cada paciente. A janela avaliada é sempre recortada por esse piso.

- hábito → `patient_habit_checklists.start_date` da grade ativa
- medição / meta → `created_at` da meta ativa, ou primeira medição
- portal → primeiro acesso registrado
- retorno → `created_at` do paciente

**Por quê**: sem o piso, uma grade criada ontem dispara "sem registro há 5 dias"
usando dias em que a grade não existia. Cobrar alguém por não ter feito o que
ainda não lhe foi pedido é o tipo de erro que destrói confiança na automação
inteira, não só naquela regra.

---

## D11 — Parâmetros em JSONB, validados por Zod da família

**Decisão**: `signal_rules.params JSONB`, com o schema Zod vindo do catálogo
(D2). Validado na escrita (API) e de novo na leitura pelo motor.

**Por quê**: as famílias têm parâmetros heterogêneos — item de checklist, tipo
de métrica, número de dias, número de meses. Coluna por parâmetro vira tabela
esparsa que muda a cada família nova. Validar duas vezes é barato e protege
contra linha gravada antes de uma mudança de schema.

---

## D12 — Módulo `acompanhamento`, com gate no motor

**Decisão**: novo `ModuleId` `acompanhamento`, seguindo o padrão do repo. Gate
na página **e no motor**.

**Por quê**: aprendido na 051 — `reminder_channels` era estado persistido e o
gate só de UI significava que revogar o módulo no `/admin` não tinha efeito
retroativo; a clínica seguia enviando. Regra ligada é o mesmo tipo de estado
persistido. O gate no motor é o que faz a revogação valer.

---

## Numeração e nomes

- **Migration**: `0192_patient_signal_rules.sql` (última é a `0191`).
- **Tabelas novas**: `signal_rules`, `signal_occurrences`, `patient_messages`.
- **Coluna nova**: `patients.outreach_opt_in`.
- **Rotas novas**: `/api/cron/patient-signals`,
  `/api/workers/send-patient-message`, `/api/notificacoes-automaticas` (CRUD).
- **Tela**: `/configuracoes/notificacoes-automaticas`.
