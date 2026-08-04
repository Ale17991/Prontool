# Contrato — Catálogo de famílias de regra

`src/lib/core/signals/catalog.ts`. Fonte da verdade do que cada regra observa.
É **código**, não tabela (research D2). Acrescentar família é PR, não migração.

## Forma da família

```ts
interface SignalFamily {
  id: SignalFamilyId
  label: string
  description: string

  /** Zod dos parâmetros que a clínica preenche. */
  paramsSchema: z.ZodType

  /** Campos que o texto pode usar. Texto com campo fora desta lista é recusado (FR-Ⅲ/US3). */
  placeholders: readonly string[]

  /** Texto padrão, na voz "não vimos seu registro" (research D9, camada 1). */
  defaultTemplate: string

  /** Padrão da janela de silêncio, em dias. A clínica pode ajustar. */
  defaultSilenceDays: number

  /**
   * TRUE quando a regra observa REGISTRO do paciente. Liga os dois filtros de
   * portal (research D4): elegibilidade (já entrou alguma vez) e supressão
   * (entrou dentro da janela).
   */
  requiresPortalActivity: boolean

  /** Desempate quando várias regras concorrem pelo mesmo paciente (D6). Menor = fala primeiro. */
  priority: number

  /** Avaliação. Devolve um candidato por paciente que bate a condição. */
  evaluate(ctx: EvaluationContext): Promise<SignalCandidate[]>
}

interface SignalCandidate {
  patientId: string
  /** O que foi visto. Vai cru para `signal_occurrences.observed`. */
  observed: Record<string, unknown>
  /** Valores dos placeholders para este paciente. */
  values: Record<string, string>
}
```

## As catorze famílias de v1

Duas naturezas, e a distinção não é cosmética — muda quais filtros se aplicam.

| Natureza | Famílias | Filtro de portal (D4) | Expressões proibidas (D9) | Prioridade |
|---|---|---|---|---|
| **Celebração** | 5 | não se aplica | não se aplica | 1–9 |
| **Ausência** | 9 | quando observa registro do paciente | sempre | 10+ |

Uma família de celebração observa evento **presente** no dado. Não há suposição
a controlar — o paciente atingiu a meta, marcou os sete dias, fez aniversário.
Não há como acusar alguém de algo que ele fez. Por isso ela escapa dos dois
filtros que existem só para proteger contra a inferência de ausência.

**Precedência sobre a ausência quando o teto binda** (FR-002b): a faixa 1–9
garante que, se o paciente só pode receber uma mensagem esta semana, ela seja a
que reconhece, não a que cobra.

---

## Celebração

### `meta_atingida` — prioridade 1

- **Observa**: `patient_metric_goals` ativa + `patient_measurements`.
- **Params**: `{ metricType: string }`.
- **Condição**: a medição mais recente alcançou ou superou a meta, e a anterior
  não tinha alcançado — dispara na **virada**, não todo dia depois.
- **Placeholders**: `paciente`, `metrica`, `clinica`. **Sem valor numérico**,
  pela mesma razão de `afastando_da_meta`.
- **Silêncio padrão**: 30 dias.

### `sequencia_habito` — prioridade 2

- **Observa**: `habit_checklist_marks`.
- **Params**: `{ itemId?: string, days: number }`.
- **Condição**: `days` dias consecutivos com registro. Reusa `currentStreak` do
  `itemStats` que já existe em `habits/period.ts`.
- **Placeholders**: `paciente`, `habito`, `dias`, `clinica`.
- **Silêncio padrão**: 14 dias — senão dispara todo dia depois da sequência.

### `aniversario` — prioridade 3

- **Observa**: data de nascimento do paciente.
- **Params**: `{}`.
- **Condição**: hoje, no fuso da clínica.
- **Placeholders**: `paciente`, `clinica`. **Silêncio padrão**: 300 dias.

### `aniversario_acompanhamento` — prioridade 4

- **Observa**: primeira consulta do paciente em `appointments`.
- **Params**: `{ months: number }` — a cada quantos meses celebrar.
- **Placeholders**: `paciente`, `meses`, `clinica`. **Silêncio padrão**: 60 dias.

### `pos_consulta` — prioridade 5

- **Observa**: `appointments` concluídas.
- **Params**: `{ days: number }` — quantos dias depois.
- **Condição**: consulta concluída há exatamente `days` dias.
- **Placeholders**: `paciente`, `dias`, `clinica`. **Silêncio padrão**: 7 dias.

---

## Ausência

### `habito_sem_registro`

- **Observa**: `habit_checklist_marks` da grade ativa.
- **Params**: `{ itemId?: string, days: number }` — `itemId` ausente significa
  "qualquer item da grade".
- **Condição**: nenhum registro do item por `days` dias corridos, contados até
  ontem (hoje ainda não acabou — cobrar o dia em curso é cobrar cedo demais).
- **Piso da janela** (D10): `patient_habit_checklists.start_date`.
- **Placeholders**: `paciente`, `habito`, `dias`, `clinica`.
- **`requiresPortalActivity`**: `true`.
- **Silêncio padrão**: 7 dias.
- **Prioridade**: 20.
- **Agregação**: paciente com dois itens abandonados vira **um** candidato, com
  os itens listados em `observed` e `habito` renderizado como lista (FR-013).

Texto padrão:
> Oi {{paciente}}, aqui é da {{clinica}}. Não vimos seu registro de
> {{habito}} nos últimos {{dias}} dias. Se estiver tudo certo e só faltou
> marcar, é só abrir o portal quando puder. Se algo atrapalhou, conte pra
> gente — a gente ajusta junto.

### `sem_registrar_medicao`

- **Observa**: `patient_measurements` do tipo escolhido.
- **Params**: `{ metricType: string, days: number }`.
- **Condição**: nenhuma medição daquele tipo há `days` dias.
- **Piso**: primeira medição do paciente, ou `created_at` do paciente.
- **Placeholders**: `paciente`, `metrica`, `dias`, `clinica`.
- **`requiresPortalActivity`**: `true`.
- **Silêncio padrão**: 10 dias. **Prioridade**: 30.

### `afastando_da_meta`

- **Observa**: `patient_metric_goals` ativa + as duas últimas
  `patient_measurements` da métrica.
- **Params**: `{ metricType: string, consecutive: number }` — quantas medições
  seguidas na direção contrária.
- **Condição**: `consecutive` medições consecutivas afastando-se da meta.
- **Piso**: `created_at` da meta ativa.
- **Placeholders**: `paciente`, `metrica`, `clinica`. **Sem placeholder de
  valor** — ver abaixo.
- **`requiresPortalActivity`**: `false` (o dado pode vir da clínica).
- **Silêncio padrão**: 21 dias. **Prioridade**: 40.

> **O texto desta família não menciona número nem julga o resultado.** Mandar
> "seu peso subiu 2 kg" por WhatsApp é devolver ao paciente um dado clínico sem
> ninguém junto para interpretá-lo, e para um público que frequentemente tem
> relação difícil com esse número. A regra existe para **trazer o paciente para
> a consulta**, não para dar o veredito por mensagem. Por isso `placeholders`
> não oferece valor nem delta — a restrição está no contrato, não na boa vontade
> de quem escreve o texto.

Texto padrão:
> Oi {{paciente}}, aqui é da {{clinica}}. Demos uma olhada no seu
> acompanhamento de {{metrica}} e queríamos conversar sobre ele com você. Que
> tal marcarmos um horário?

### `sem_acesso_portal`

- **Observa**: `patient_portal_access_log`.
- **Params**: `{ days: number }`.
- **Condição**: nenhum acesso há `days` dias.
- **Elegibilidade**: precisa ter ao menos um acesso na história — quem nunca
  entrou não "sumiu".
- **Piso**: primeiro acesso.
- **Placeholders**: `paciente`, `dias`, `clinica`.
- **`requiresPortalActivity`**: `false` — **é ela que observa o sumiço**;
  aplicar o filtro aqui a anularia.
- **Silêncio padrão**: 14 dias. **Prioridade**: 10 — a mais alta, porque é a que
  atende quem as outras suprimiram (FR-010).

### `sem_retorno`

- **Observa**: `appointments`.
- **Params**: `{ months: number }`.
- **Condição**: nenhuma consulta há `months` meses **e** nenhuma consulta
  futura marcada.
- **Piso**: `created_at` do paciente.
- **Placeholders**: `paciente`, `meses`, `clinica`.
- **`requiresPortalActivity`**: `false`.
- **Silêncio padrão**: 45 dias. **Prioridade**: 50.

### `exame_nao_realizado` — prioridade 45

- **Observa**: `exam_requests` (`issued_at`, `deleted_at`) contra
  `patient_measurements` de analitos de laboratório.
- **Params**: `{ days: number }`.
- **Condição**: exame emitido há `days` dias sem nenhum resultado registrado
  depois da emissão.
- **`requiresPortalActivity`**: `false` — o resultado costuma ser lançado pela
  clínica, não pelo paciente.
- **Placeholders**: `paciente`, `dias`, `clinica`. **Silêncio padrão**: 15 dias.

### `avaliacao_vencida` — prioridade 55

- **Observa**: `nutrition_assessments.assessed_at`.
- **Params**: `{ months: number }`.
- **`requiresPortalActivity`**: `false`.
- **Placeholders**: `paciente`, `meses`, `clinica`. **Silêncio padrão**: 30 dias.

### `recordatorio_em_branco` — prioridade 35

- **Observa**: `food_recalls.recall_date`.
- **Params**: `{ days: number }`.
- **`requiresPortalActivity`**: `true` — é registro do paciente.
- **Placeholders**: `paciente`, `dias`, `clinica`. **Silêncio padrão**: 10 dias.

### `plano_alimentar_sem_revisao` — prioridade 60

- **Observa**: `diet_plan_prescriptions` / `diet_plans`.
- **Params**: `{ months: number }`.
- **Condição**: prescrição ativa criada há `months` meses sem revisão posterior.
- **`requiresPortalActivity`**: `false`.
- **Placeholders**: `paciente`, `meses`, `clinica`. **Silêncio padrão**: 45 dias.

## Invariantes cobertas por teste

1. Todo `defaultTemplate` **de família de ausência** passa na lista de
   expressões proibidas (D9, camada 1).
2. Todo `defaultTemplate` só usa placeholders declarados pela própria família.
3. `priority` é única entre as famílias — empate reintroduziria não-determinismo
   no desempate do teto (FR-021).
4. Toda família com `requiresPortalActivity: true` observa registro feito pelo
   paciente. Marcar `false` numa família dessas reabre a cobrança indevida.
5. Nem `afastando_da_meta` nem `meta_atingida` declaram placeholder de valor
   numérico. A restrição vale nos dois sentidos: "seu peso caiu 4 kg" parece
   inofensivo, mas é o mesmo dado clínico sem interlocutor, e estabelece que o
   número é o assunto — o que torna a mensagem seguinte, quando ele subir, muito
   pior.
6. **Toda família de celebração tem `priority < 10` e toda família de ausência
   tem `priority >= 10`.** É o que faz FR-002b valer sem lógica extra: o
   desempate por prioridade já entrega a precedência do reconhecimento.
7. Nenhuma família de celebração declara `requiresPortalActivity: true`.
