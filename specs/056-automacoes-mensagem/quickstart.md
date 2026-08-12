# Quickstart — Automações de mensagem (056)

Como subir e testar a feature ponta a ponta.

> ⚠️ `vitest` chama `resetDatabase()` e apaga **todos** os dados e usuários do banco local. Re-semear depois com `pnpm seed:demo`.

---

## 1. Pré-requisitos

- Supabase local no ar (`npx supabase start`, porta 54321)
- Migration aplicada: `pnpm supabase:reset` (ou `npx supabase migration up --local` para preservar o seed)
- Módulo **`automacoes`** ligado na clínica de teste, pelo `/admin`
- Módulo **`whatsapp`** ligado e número conectado — sem isso o motor registra `impedido_sem_conexao` e nada sai
- Módulo **`habitos`** ligado, se for testar os gatilhos de checklist

---

## 2. Montar a primeira automação

1. `pnpm dev`, entre como **admin**.
2. `Configurações → Automações → Mensagens → Nova`:
   nome `Aniversário`, corpo `Feliz aniversário, {{paciente}}! A equipe da {{clinica}} deseja um ótimo dia.`
3. `Gatilhos → Novo`: fonte **Aniversário do paciente**.
4. `Automações → Nova`: ligue os dois. Ela **nasce desligada**.
5. Antes de ativar, confira a **prévia** — quantos pacientes satisfazem hoje.
6. Ative.

## 3. Preparar um paciente

- Data de nascimento **hoje**
- Telefone válido
- `reminders_opt_in` (mestre) **ligado**
- `automations_opt_in` **ligado** — ele nasce desligado de propósito, então é preciso ligar à mão

## 4. Rodar o ciclo

```bash
curl -X POST http://localhost:3000/api/cron/send-reminders \
  -H "Authorization: Bearer $CRON_SECRET"
```

Em produção o disparo é o **Vercel Cron**, que chama com **`GET`**. A rota aceita os dois métodos desde o conserto de 11/08/2026 — antes disso só aceitava `POST` e o ciclo nunca rodou sozinho. Se um dia o ciclo parar de rodar em produção de novo, **este é o primeiro lugar para olhar**: `GET /api/cron/send-reminders 405` nos logs da Vercel.

Esperado na resposta: `automacoes.enviadas: 1`.

## 5. Conferir

- A mensagem chega no celular, com o nome substituído
- `Automações` mostra a contagem de enviados
- Rodar o `curl` de novo **não** manda mensagem nova (colisão no `UNIQUE` da ocorrência)

---

## 6. Casos que valem testar à mão

| Cenário | Como forçar | Esperado |
|---|---|---|
| Sem consentimento | desligue `automations_opt_in` | `impedido_sem_consentimento`, nada enviado |
| Consentimento mestre negado | desligue `reminders_opt_in` | impedido, mesmo com `automations_opt_in` ligado |
| Sem telefone | limpe o telefone | `impedido_sem_telefone` |
| Variável sem dado | mensagem com `{{profissional}}` num gatilho que não fornece | recusado **ao associar**, não no envio |
| Teto por paciente | duas automações ativas atingindo o mesmo paciente no mesmo dia | uma sai, a outra fica `suprimido_teto_paciente` |
| Teto por clínica | baixe `automation_max_per_cycle` para 2 e satisfaça 5 pacientes | 2 saem, 3 suprimidos, e os 3 saem no ciclo seguinte |
| Ciclo repetido | rode o `curl` duas vezes | segunda não envia nada |
| Módulo revogado | desligue `automacoes` no `/admin` com automação ativa | motor ignora a clínica, **sem** gerar alerta |
| Paciente anonimizado | anonimize um paciente candidato | sai da avaliação |
| Exclusão de mensagem em uso | tente excluir | `409` nomeando os gatilhos |
| Gatilho de ausência | abra o formulário | a tela diz "não marcou", nunca "não cumpriu" (FR-009) |
| Entrega e leitura | POST em `/api/webhooks/whatsapp-status` com `externalId` = **id da ocorrência** e o Bearer da clínica | evento gravado com `automation_occurrence_id`, e a lista passa a mostrar "entregue"/"lida" |
| Fronteira com o SC-004 | apure a taxa de leitura de LEMBRETE na mesma clínica | os eventos de automação **não** entram — as duas medidas dividem tabela desde a 0197 |

## 6b. As dezesseis fontes

Cada uma tem um cenário mínimo. As de **estado contínuo** (marcadas ✱) entram
com todo mundo que já está na condição no dia em que a automação é ligada — veja
a prévia antes de ativar.

| Fonte | Cenário mínimo para disparar |
|---|---|
| `aniversario` | paciente com `birth_date` = hoje (mês e dia) |
| `aniversario_cadastro` | paciente cadastrado em 11/08 de um ano anterior |
| `boas_vindas` | paciente cadastrado há N dias |
| `confirmacao_agendamento` | atendimento **criado** ontem |
| `pre_consulta` | atendimento marcado para daqui a N dias, não cancelado |
| `pos_atendimento` | atendimento com `appointment_completions` de N dias atrás |
| `falta_consulta` | `appointment_flow.status = 'desmarcou'` num atendimento de N dias atrás |
| `agendamento_cancelado` | `appointment_cancellations` de ontem |
| `sem_retorno` ✱ | paciente sem nenhum atendimento nos últimos N meses |
| `checklist_marcado` | N marcações do item no período corrente |
| `checklist_sem_marcacao` | N dias seguidos sem marcação, dentro do período |
| `meta_atingida` | meta ativa + **última** medição alcançando o alvo |
| `sem_medicao` ✱ | paciente com medição antiga e nenhuma nos últimos N dias |
| `plano_alimentar_revisao` | `diet_plans` ativo criado há exatamente N dias (módulo `dieta`) |
| `parcela_a_vencer` | `payment_installments` em aberto vencendo em N dias |
| `parcela_vencida` | idem, vencida há N dias |
| `orcamento_sem_resposta` | `treatment_budgets` apresentado há N dias, sem aceite nem recusa |
| `etapa_sem_agendamento` ✱ | etapa pendente sem `scheduled_date` parada há mais de N dias |
| `exame_sem_retorno` | `exam_requests` com `issued_at` de N dias atrás |

Duas conferências de linguagem valem fazer na tela, porque são obrigação da
fonte e não do componente: `falta_consulta`, `checklist_sem_marcacao`,
`sem_medicao` e `exame_sem_retorno` precisam mostrar o aviso de que o sistema
sabe o registro, não o comportamento. E `parcela_vencida` precisa mostrar o
aviso do art. 42 do CDC — nessas duas fontes financeiras, procedimento e
profissional **não estão disponíveis como variável**, de propósito.

## 7. Checklist de hábitos

Gatilhos de checklist precisam de marcações reais. Pelo portal do paciente (`/paciente/<slug>/painel`) é o caminho mais fiel; para montar cenário rápido, inserir em `habit_checklist_marks` direto funciona, desde que respeite `UNIQUE (checklist, item, dia)`.

Lembre que **período é calculado, não materializado**: "semana corrente" sai de `start_date` + `period_kind` do checklist do paciente, não de uma tabela de períodos.

---

## 8. Antes de dizer que terminou

```bash
pnpm typecheck
pnpm lint:auth     # rotas de /api/* autenticam
pnpm test          # ⚠️ apaga o banco local
```

**Pré-requisito operacional para produção**, e não é polimento: `QSTASH_TOKEN` e as duas signing keys precisam estar na Vercel. Sem elas o envio cai no caminho inline com teto de 10 por ciclo e espaçamento de 1 s — e o espaçamento é a única mitigação contra bloqueio do número, que agora passa a carregar também o volume das automações.
