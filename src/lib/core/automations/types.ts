/**
 * Feature 056 — tipos canônicos do construtor de automações.
 *
 * A cápsula é IRMÃ de `core/reminders`, não subordinada a ela. O lembrete de
 * consulta segue com motor e configuração próprios (FR-024); este construtor
 * cobre as fontes novas. A separação é decisão de risco, não de gosto: o motor
 * de lembrete passou a funcionar em produção em 11/08/2026, depois de meses
 * parado por um defeito silencioso, e reescrevê-lo agora seria trocar uma
 * certeza recém-conquistada por uma promessa.
 *
 * O que torna a absorção futura possível (FR-025) é o `AutomationSourceDef`
 * abaixo: quando chegar a hora, "lembrete de consulta" vira mais uma fonte
 * cujo `enumerate` delega para `selectDueAppointments`, sem tocar no motor nem
 * no modelo de dados.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { ZodTypeAny } from 'zod'

/**
 * Desfecho de uma ocorrência. `pendente` é gravado ANTES da tentativa de envio
 * e substituído depois — ver o trigger append-only da migration 0196.
 */
export type OccurrenceOutcome =
  | 'pendente'
  | 'enviado'
  | 'suprimido_teto_paciente'
  | 'suprimido_teto_clinica'
  | 'impedido_sem_consentimento'
  | 'impedido_sem_telefone'
  | 'impedido_sem_whatsapp'
  | 'impedido_variavel_ausente'
  | 'impedido_sem_conexao'
  | 'falhou'

/** Supressão não é desfecho final — a linha é removível para reavaliação. */
export const SUPPRESSED_OUTCOMES: readonly OccurrenceOutcome[] = [
  'suprimido_teto_paciente',
  'suprimido_teto_clinica',
]

/**
 * Um candidato devolvido por uma fonte: o paciente, a chave que identifica ESTA
 * ocorrência, e as variáveis que a fonte consegue preencher para ele.
 */
export interface SourceCandidate {
  patientId: string
  /**
   * O que "uma ocorrência" significa para esta fonte — data para aniversário,
   * id do atendimento para confirmação, índice do período para checklist.
   * É a terceira parte do UNIQUE que torna "uma vez só" propriedade do banco.
   */
  occurrenceKey: string
  /** Valores para as variáveis declaradas em `variables`. */
  variables: Record<string, string>
}

export interface EnumerateContext {
  supabase: SupabaseClient
  tenantId: string
  /** Dia civil da clínica em `YYYY-MM-DD`, nunca a data do servidor. */
  today: string
  /** Instante deste ciclo. É o fim da janela das fontes ancoradas. */
  now: Date
  /**
   * Início da janela deste ciclo — o instante da varredura anterior.
   *
   * Só as fontes ANCORADAS num horário o usam ("2 horas antes da consulta"): a
   * pergunta delas não é "que dia é hoje" e sim "que âncoras venceram desde a
   * última vez que olhei". As fontes de dia civil ignoram, e continuam contando
   * em dias da clínica.
   *
   * O motor sempre preenche; quem chama `enumerate` de fora do ciclo (a prévia,
   * um teste) recebe uma janela sintética de 15 minutos, que é o intervalo do
   * ciclo. Prévia com janela maior mentiria para cima.
   */
  windowFrom: Date
  /**
   * Esta enumeração é a PRÉVIA da tela, medindo o dia inteiro.
   *
   * A prévia usa a mesma consulta e as mesmas regras de elegibilidade — o que
   * muda é só o tamanho da janela, e por consequência uma filtragem: a fonte
   * ancorada descarta o atendimento que já começou, porque avisar sobre ele seria
   * mandar a pessoa se preparar para o que já aconteceu. Na prévia, que varre um
   * dia inteiro de uma vez, esse descarte apagaria justamente os atendimentos da
   * manhã e a clínica veria um número menor que o real.
   */
  previewMode?: boolean
  /**
   * Fuso da clínica. Vem junto com `today` porque as duas coisas respondem
   * perguntas diferentes: `today` diz QUE DIA é para esta clínica, o fuso diz
   * onde esse dia começa e termina em UTC — e é ele que decide se um
   * agendamento feito às 22h conta como de ontem ou de hoje.
   */
  timezone: string
  /** Nome da clínica — variável universal, preenchida pelo motor. */
  clinicName: string
  params: Record<string, unknown>
  /**
   * Memória compartilhada entre as fontes de UM ciclo de UMA clínica.
   *
   * Existe por causa de uma conta: a lista de pacientes aptos é a mesma para
   * todas as fontes, e uma clínica com 5.000 pacientes e 16 automações ativas
   * pagaria 80 páginas de 1.000 linhas por ciclo para reconstruir a mesma
   * resposta dezesseis vezes.
   *
   * É opcional de propósito — quem chama `enumerate` de fora do ciclo (a prévia,
   * um teste) não precisa fabricar cache, e a ausência dele só custa a consulta
   * a mais. O motor cria UM por clínica e o descarta ao terminar: cache que
   * atravessa ciclos guardaria consentimento revogado.
   */
  cache?: Map<string, unknown>
}

/**
 * Agrupamento da fonte na tela. Com uma fonte, lista; com dezesseis, a clínica
 * precisa achar a que quer sem ler todas.
 */
export type SourceGroup =
  | 'relacionamento'
  | 'agenda'
  | 'checklist'
  | 'acompanhamento'
  | 'financeiro'
  | 'tratamento'

export const SOURCE_GROUP_LABEL: Record<SourceGroup, string> = {
  relacionamento: 'Relacionamento',
  agenda: 'Agenda',
  checklist: 'Checklist de hábitos',
  acompanhamento: 'Acompanhamento clínico',
  financeiro: 'Financeiro',
  tratamento: 'Tratamento e exames',
}

/**
 * De onde a tela busca as opções de um campo de escolha.
 *
 * O catálogo é resolvido NO SERVIDOR, na rota que lista as fontes: item de
 * checklist e tipo de métrica são dados da clínica, e pedir para a tela
 * descobri-los sozinha espalharia consulta de domínio pelo componente.
 */
export type SourceOptionSet = 'habit_items' | 'metric_types'

/**
 * A descrição declarativa de um parâmetro, para a tela montar o campo.
 *
 * Existe porque o `paramsSchema` (Zod) valida mas não descreve: dele não sai
 * rótulo em português, nem a diferença entre "um número de dias" e "escolha um
 * item do checklist deste paciente". Sem isto a tela precisaria conhecer cada
 * fonte nominalmente — exatamente o acoplamento que o registro existe para
 * evitar. O primeiro efeito prático é que TODA fonte com parâmetro passa a ser
 * criável pela interface; antes, três das cinco não eram.
 */
export interface SourceParamField {
  /** Chave dentro de `params`, igual à do `paramsSchema`. */
  readonly name: string
  readonly label: string
  /**
   * `duration` é número MAIS unidade (minutos, horas, dias), e o valor que chega
   * em `params` é sempre em MINUTOS.
   *
   * A unidade não é guardada: 120 volta para a tela como "2 horas" porque a
   * própria tela escolhe a maior unidade que divide exato. Guardar o par
   * (valor, unidade) criaria dois jeitos de escrever a mesma antecedência —
   * `{2, horas}` e `{120, minutos}` — e o motor teria que normalizar assim
   * mesmo, com o risco de dois gatilhos idênticos parecerem diferentes e não
   * serem reaproveitados.
   */
  readonly kind: 'number' | 'text' | 'select' | 'duration'
  readonly hint?: string
  /** Em `duration`, `min`/`max`/`defaultValue` são em MINUTOS. */
  readonly min?: number
  readonly max?: number
  readonly defaultValue?: string | number
  /** Só para `kind: 'select'` — opções vindas do catálogo da clínica. */
  readonly optionsFrom?: SourceOptionSet
  /**
   * Só para `kind: 'select'` — opções FIXAS, definidas pela própria fonte.
   *
   * Diferente de `optionsFrom`, que busca dado da clínica (quais hábitos, quais
   * métricas). Aqui as escolhas são do domínio da fonte e não mudam de clínica
   * para clínica: "no dia do aniversário / dias antes / no início do mês" é a
   * gramática daquela fonte, não um cadastro.
   */
  readonly options?: ReadonlyArray<{ readonly value: string; readonly label: string }>
  /**
   * Só mostra este campo quando outro campo estiver num destes valores.
   *
   * Existe porque parâmetro que não se aplica é pior que parâmetro ausente: a
   * clínica escolhe "no início do mês do aniversário" e continua vendo um campo
   * "quantos dias antes" que o motor vai ignorar — e não tem como saber que vai.
   * A regra é declarada pela FONTE, como todo o resto: a tela continua sem
   * conhecer nenhuma delas.
   */
  readonly showWhen?: { readonly field: string; readonly equals: readonly string[] }
}

/**
 * O contrato que toda fonte de gatilho implementa. É o ponto ÚNICO de extensão
 * da feature: adicionar fonte é adicionar um arquivo, não uma migration.
 */
export interface AutomationSourceDef {
  /** Chave persistida em `automation_triggers.source`. */
  readonly id: string
  readonly label: string
  readonly group: SourceGroup
  /** Explica à clínica o que a fonte faz. */
  readonly hint: string
  /**
   * Módulo exigido, quando a fonte lê dado de uma vertical contratável.
   *
   * Sem isto, uma clínica odontológica escolheria "plano alimentar para
   * revisão" numa lista que sempre devolveria zero candidato — e um gatilho que
   * nunca dispara não parece não-contratado, parece quebrado.
   */
  readonly requiresModule?: string
  /**
   * Aviso obrigatório na tela de configuração, quando existe.
   *
   * FR-009 vive aqui, e não na tela, de propósito: o guarda-corpo pertence à
   * fonte que conhece a limitação do próprio dado. Deixá-lo no componente faria
   * a próxima fonte de ausência nascer sem ele.
   */
  readonly warning?: string
  /** Schema dos parâmetros que a clínica configura — a validação. */
  readonly paramsSchema: ZodTypeAny
  /** Os mesmos parâmetros, descritos para a tela — a apresentação. */
  readonly fields?: readonly SourceParamField[]
  /**
   * Variáveis que esta fonte sabe preencher, além das universais.
   * Usado para recusar, no momento de ASSOCIAR gatilho a mensagem, um texto que
   * peça dado que a fonte não tem — erro na tela de quem monta, não mensagem
   * torta no celular do paciente três dias depois.
   */
  readonly variables: readonly string[]
  /**
   * Estes parâmetros ancoram o envio num HORÁRIO, e não num dia?
   *
   * É a fonte quem responde porque é ela quem sabe se tem âncora: "2 horas antes
   * da consulta" tem (o horário marcado), "6 meses sem atendimento" não tem
   * horário nenhum ao qual se agarrar. A mesma fonte responde diferente conforme
   * o parâmetro — `pre_consulta` com 2 dias é diária, com 2 horas é ancorada.
   *
   * A resposta decide DUAS coisas no motor: se a automação roda em todo ciclo
   * (ancorada) ou uma vez por dia no horário escolhido (diária), e se o
   * `send_at_local` da automação vale. Ancorada ignora o horário escolhido —
   * "2 horas antes da consulta, às 14:30" é uma contradição, e a tela desabilita
   * o campo em vez de deixar a clínica escrever uma regra que não pode valer.
   */
  isAnchored?(params: Record<string, unknown>): boolean
  enumerate(ctx: EnumerateContext): Promise<SourceCandidate[]>
}

/** Variáveis que o motor preenche para qualquer fonte. */
export const UNIVERSAL_VARIABLES = ['paciente', 'clinica'] as const

export interface AutomationRow {
  id: string
  tenantId: string
  triggerId: string
  messageTemplateId: string
  active: boolean
  source: string
  params: Record<string, unknown>
  body: string
  name: string
  /** `HH:MM` no relógio da clínica. Ignorado quando a fonte é ancorada. */
  sendAtLocal: string
  /** Dia civil da clínica na última vez que esta automação disparou. */
  lastFiredOn: string | null
  /** Instante da última varredura — janela das fontes ancoradas. */
  lastRanAt: string | null
  triggerName: string
  messageName: string
}

export interface EvaluateResult {
  avaliadas: number
  enviadas: number
  suprimidas: number
  impedidas: number
  falhas: number
}
