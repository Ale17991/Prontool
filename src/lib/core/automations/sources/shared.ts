/**
 * Feature 056 — o que toda fonte de gatilho precisa e nenhuma deveria
 * reimplementar.
 *
 * Duas coisas moram aqui por motivo de correção, não de arrumação:
 *
 * 1. **A elegibilidade do paciente é UMA regra.** Paciente inativo, anonimizado,
 *    sem consentimento ou sem telefone não pode ser candidato de fonte nenhuma
 *    (FR-017). Com dezesseis fontes, deixar cada uma escrever seu próprio filtro
 *    é garantir que a décima sétima nasça esquecendo um dos quatro — e o
 *    esquecimento que importa é o do anonimizado, que manda mensagem para quem
 *    exerceu o direito de sumir.
 *
 * 2. **Toda consulta pagina.** O PostgREST devolve no máximo 1.000 linhas por
 *    resposta e não avisa que cortou. Uma clínica com 1.200 pacientes aptos
 *    simplesmente perderia 200 deles de toda automação, em silêncio, para
 *    sempre — o mesmo defeito que a 0194 achou no `detect-deprecated` do TUSS,
 *    onde o scan concluía tranquilo sobre um pedaço dos dados.
 */

import { z } from 'zod'
import type { EnumerateContext } from '../types'

const PAGINA = 1000

/** O que uma consulta PostgREST devolve quando aguardada. */
type Resposta = { data: unknown; error: { message: string } | null }

/**
 * Percorre uma consulta até o fim, em páginas.
 *
 * Recebe uma FÁBRICA de consulta e não uma consulta pronta porque o builder do
 * PostgREST é de uso único: reaproveitá-lo entre páginas acumula `range` sobre
 * `range`. Cada página monta a sua.
 */
export async function pageAll<T>(
  // O builder do PostgREST tem genéricos que variam por tabela; aqui só
  // interessa que ele aceite `.range()` e devolva `{ data, error }`.
  build: (from: number, to: number) => PromiseLike<Resposta>,
  rotulo: string,
): Promise<T[]> {
  const out: T[] = []
  for (let pagina = 0; ; pagina++) {
    const from = pagina * PAGINA
    const { data, error } = await build(from, from + PAGINA - 1)
    if (error) throw new Error(`${rotulo} falhou: ${error.message}`)
    const linhas = (data ?? []) as T[]
    out.push(...linhas)
    if (linhas.length < PAGINA) return out
    // Cinto de segurança: 100 páginas são 100 mil linhas. Passar disso é
    // consulta mal desenhada, não clínica grande.
    if (pagina >= 99) return out
  }
}

/**
 * Os pacientes que PODEM receber mensagem de automação nesta clínica.
 *
 * As quatro condições são cumulativas e nenhuma é redundante com a checagem que
 * o motor refaz na hora de enviar: aqui elas evitam trabalho (decifrar, contar,
 * consultar) para quem nunca receberia; lá elas evitam o envio, que é o que
 * conta. A duplicação é deliberada — defesa em camadas.
 */
export async function eligiblePatients(ctx: EnumerateContext): Promise<Set<string>> {
  const emCache = ctx.cache?.get('eligiblePatients')
  if (emCache instanceof Set) return emCache as Set<string>

  const linhas = await pageAll<{ id: string }>(
    (from, to) =>
      ctx.supabase
        .from('patients')
        .select('id')
        .eq('tenant_id', ctx.tenantId)
        .eq('status', 'ativo')
        .eq('automations_opt_in', true)
        .is('anonymized_at', null)
        .not('phone_enc', 'is', null)
        .order('id')
        .range(from, to) as unknown as PromiseLike<Resposta>,
    'eligiblePatients',
  )
  const aptos = new Set(linhas.map((p) => p.id))
  ctx.cache?.set('eligiblePatients', aptos)
  return aptos
}

// ---------------------------------------------------------------------------
// Datas — dia civil, sempre. Um gatilho acontece no dia da clínica.
// ---------------------------------------------------------------------------

export function isoDe(dt: Date): string {
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(
    dt.getUTCDate(),
  ).padStart(2, '0')}`
}

export function addDias(iso: string, delta: number): string {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number]
  return isoDe(new Date(Date.UTC(y, m - 1, d) + delta * 86_400_000))
}

export function mesesAtras(iso: string, meses: number): string {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number]
  return isoDe(new Date(Date.UTC(y, m - 1 - meses, d)))
}

/**
 * A janela UTC que cobre um dia civil da clínica, para filtrar `TIMESTAMPTZ`.
 *
 * Aproximação pelo fuso da clínica: sem ela, "criado ontem" em São Paulo
 * incluiria as três primeiras horas de hoje e excluiria as três primeiras de
 * ontem — um agendamento feito às 22h cairia no dia errado, e a confirmação
 * sairia com um dia de atraso ou não sairia.
 */
export function janelaDoDia(diaCivil: string, timezone: string): { de: string; ate: string } {
  const offset = offsetHoras(timezone, diaCivil)
  const meiaNoite = Date.parse(`${diaCivil}T00:00:00.000Z`) + offset * 3_600_000
  return {
    de: new Date(meiaNoite).toISOString(),
    ate: new Date(meiaNoite + 86_400_000).toISOString(),
  }
}

/** Quantas horas somar a um instante UTC para chegar ao relógio local. */
function offsetHoras(timezone: string, diaReferencia: string): number {
  try {
    const amostra = new Date(`${diaReferencia}T12:00:00.000Z`)
    const local = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hour: 'numeric',
      hour12: false,
    }).format(amostra)
    // 12h UTC no fuso local: São Paulo devolve 9 → offset -3 → soma +3 para ir
    // de meia-noite local a UTC.
    return 12 - Number(local)
  } catch {
    return 3
  }
}

// ---------------------------------------------------------------------------
// Antecedência em minutos — as fontes com âncora de horário
// ---------------------------------------------------------------------------

export const MINUTOS_POR_DIA = 1440

/**
 * Uma antecedência em minutos é ANCORADA quando não fecha em dias inteiros.
 *
 * O critério é aritmético: "2 dias antes" e "2880 minutos antes" são a mesma
 * frase para o banco, mas não para quem lê a mensagem. Quem escreveu dois dias
 * espera receber no horário que a clínica escolheu para mandar; quem escreveu
 * duas horas espera receber duas horas antes, e nunca às 09:00 do dia anterior.
 *
 * A aritmética sozinha não decide o EMPATE — 1440 minutos são tanto "1 dia"
 * quanto "24 horas", e as duas leituras produzem envios diferentes. Para esse
 * caso existe `ancorada()`, que consulta a intenção gravada. Esta função é a
 * regra de fundo, usada quando não há intenção registrada (gatilho anterior à
 * mudança) — e aí o empate continua caindo em dia civil, que é o comportamento
 * que aqueles gatilhos sempre tiveram.
 */
export function ehAncorada(minutos: number): boolean {
  return minutos % MINUTOS_POR_DIA !== 0
}

/**
 * A antecedência gravada nos parâmetros, em minutos.
 *
 * Lê as DUAS grafias porque o motor entrega `automation_triggers.params` cru,
 * do jeito que está na coluna, sem passar pelo `paramsSchema` — e um gatilho
 * gravado antes desta mudança tem `{ dias: 2 }`. Deixar a conversão só no schema
 * consertaria a escrita e esqueceria a leitura: a automação continuaria ligada e
 * pararia de mandar, com `undefined` virando `NaN` no cálculo da janela e
 * nenhuma consulta casando nunca.
 *
 * Parâmetro ilegível vira zero (o mesmo que "na hora"), e não uma exceção, por
 * uma razão de alcance: `isAnchored` é consultado fora do bloco protegido, ao
 * montar a lista do ciclo, e uma exceção ali calaria as OUTRAS automações da
 * clínica. O caminho de escrita já é guardado pelo schema; isto aqui é rede.
 */
export function lerAntecedencia(params: Record<string, unknown>): number {
  const min = params.antecedenciaMin
  if (typeof min === 'number' && Number.isFinite(min)) return min
  const dias = params.dias
  if (typeof dias === 'number' && Number.isFinite(dias)) return dias * MINUTOS_POR_DIA
  return 0
}

/**
 * Esta antecedência é ancorada no horário de cada paciente?
 *
 * `ancorar` só existe nos parâmetros quando a clínica escreveu uma coisa que a
 * aritmética leria como outra — hoje, um múltiplo exato de dia expresso em horas
 * ou minutos. Fora desse empate a chave é omitida na gravação (ver
 * `antecedenciaSchema`), e por dois motivos: o gatilho é reaproveitado por
 * IGUALDADE de parâmetros, então acrescentar uma chave redundante partiria em
 * dois um gatilho que é um só; e a regra aritmética já responde certo para todo
 * o resto.
 *
 * A clínica que escreveu "24 horas antes" recebia "1 dia antes" — a automação
 * virava lote de dia civil, saía às 09:00 para todos, e a distância real ia de
 * 23h50 a 25h30 conforme a hora da consulta de cada um. Medido em produção em
 * 20/08/2026.
 */
export function ancorada(params: Record<string, unknown>): boolean {
  if (typeof params.ancorar === 'boolean') return params.ancorar
  return ehAncorada(lerAntecedencia(params))
}

/** Quantos dias inteiros são estes minutos. Só chame quando não é ancorada. */
export function emDias(minutos: number): number {
  return Math.round(minutos / MINUTOS_POR_DIA)
}

/**
 * "30 minutos", "2 horas", "2 dias" — a maior unidade que divide exato.
 *
 * Ancorada NUNCA se diz em dias, mesmo quando fecha em dias: é este texto que
 * preenche `{{antecedencia}}` na mensagem do paciente, e escrever "1 dia" numa
 * automação que dispara 24 horas antes da consulta descreveria o envio errado
 * ao próprio destinatário. É também o nome derivado do gatilho, que sem isso
 * apareceria na tela como "Antes da consulta — 1 dia" para quem pediu 24 horas.
 */
export function duracaoTexto(minutos: number, comoAncorada = false): string {
  if (minutos === 0) return 'na hora'
  if (!comoAncorada && minutos % MINUTOS_POR_DIA === 0) {
    const d = minutos / MINUTOS_POR_DIA
    return `${d} ${d === 1 ? 'dia' : 'dias'}`
  }
  if (minutos % 60 === 0) {
    const h = minutos / 60
    return `${h} ${h === 1 ? 'hora' : 'horas'}`
  }
  return `${minutos} ${minutos === 1 ? 'minuto' : 'minutos'}`
}

/**
 * O schema de uma fonte cuja antecedência é em minutos.
 *
 * Aceita o formato antigo (`{ dias: 2 }`) e o converte, porque os gatilhos
 * gravados antes desta mudança continuam no banco com aquela chave. Sem a
 * conversão, o `.strict()` recusaria a linha existente e o motor pularia a
 * automação com "parâmetros inválidos" — a clínica veria uma automação ligada
 * que simplesmente parou de mandar, sem nada na tela explicando.
 */
export function antecedenciaSchema(minMinutos: number, maxMinutos: number) {
  return z.preprocess(
    (v) => {
      if (!v || typeof v !== 'object') return v
      const o = { ...(v as Record<string, unknown>) }
      if (typeof o.dias === 'number' && o.antecedenciaMin === undefined) {
        o.antecedenciaMin = o.dias * MINUTOS_POR_DIA
        delete o.dias
      }
      // `ancorar` só sobrevive quando CONTRADIZ a aritmética — é a única
      // situação em que ele informa alguma coisa. Gravar a chave redundante
      // ("2 dias, não ancorada") partiria em dois um gatilho que é um só: o
      // reaproveitamento compara os parâmetros chave a chave, e um gatilho
      // antigo sem a chave nunca casaria com um novo que a tenha.
      if (typeof o.ancorar === 'boolean' && typeof o.antecedenciaMin === 'number') {
        if (o.ancorar === ehAncorada(o.antecedenciaMin)) delete o.ancorar
      }
      return o
    },
    z
      .object({
        antecedenciaMin: z.number().int().min(minMinutos).max(maxMinutos),
        ancorar: z.boolean().optional(),
      })
      .strict(),
  )
}

/**
 * Quanto uma mensagem ancorada pode chegar atrasada POR CULPA DO MOTOR, em
 * minutos.
 *
 * Nasceu de um caso real medido em produção (20/08/2026): uma automação de "4
 * horas antes da consulta" entregou mensagens 1h30 antes, com o texto dizendo
 * "4 horas". A mensagem afirma uma distância, e entregar fora dela não é
 * atraso: é informação falsa no celular do paciente.
 *
 * O que mudou em 04/09/2026 foi DE QUANDO este relógio conta. Ele contava do
 * instante da âncora, e com isso punia a mensagem por tempo em que o motor
 * nunca teve como agir: a noite guardada pela janela de silêncio da clínica, e
 * o intervalo em que a consulta simplesmente ainda não existia na agenda. Numa
 * clínica que abre a janela às 08:00 e avisa com 4 horas de antecedência,
 * NENHUMA consulta antes das 12:00 recebia — a âncora das 06:00 vencia com o
 * motor calado, e às 08:00 já estava fora do teto. Medido na clínica Thiago
 * Padilha entre 19/08 e 04/09: 26 mensagens perdidas pelo silêncio e 72 por
 * agenda lançada depois da âncora, contra 86 entregues.
 *
 * Hoje o relógio conta de `podeDesde` — o primeiro instante em que o envio era
 * possível. Assim o teto continua fazendo exatamente o trabalho para o qual foi
 * criado, que é cortar a cauda de uma FILA ESCOANDO devagar, e para de
 * descartar mensagem que nunca teve a sua chance.
 *
 * Trinta minutos, e não cinco, porque o escoamento é parte da operação normal:
 * com uma mensagem por ciclo de 5 minutos, seis âncoras que vencem juntas levam
 * meia hora para sair. Um teto menor mataria a cauda de todo lote — trocaria a
 * mensagem errada pela mensagem que nunca chega.
 */
export const ATRASO_MAX_MINUTOS = 30

/**
 * Quanto para trás a varredura de uma fonte ancorada NO PASSADO ("3 horas
 * depois do atendimento") busca eventos.
 *
 * Dezesseis horas cobrem a noite inteira de silêncio (20:00 → 08:00) com folga,
 * que é o buraco que `podeDesde` precisa enxergar para liberar o represado na
 * abertura da janela. Não vale para o sentido "antes", que tem alcance melhor:
 * ali a varredura pega TODO evento futuro dentro da antecedência, e é isso que
 * faz a consulta lançada em cima da hora ser alcançada.
 */
const ALCANCE_RECUPERACAO_MS = 16 * 3_600_000

/**
 * O primeiro instante em que esta mensagem PODIA ter saído.
 *
 * Três coisas atrasam legitimamente uma mensagem ancorada, e nenhuma delas é
 * culpa do motor:
 *
 * - a **âncora** ainda não tinha vencido;
 * - o **fato ainda não existia** — a consulta foi lançada na agenda depois da
 *   hora de avisar sobre ela, o que em muita clínica é a regra e não a exceção:
 *   a agenda do dia costuma ser digitada na tarde anterior;
 * - a **janela de horário da clínica estava fechada** — o motor sai antes de
 *   varrer, e sair é decisão dela, não falha nossa.
 *
 * O maior dos três é o instante a partir do qual o silêncio passa a ser nosso.
 */
export function podeDesde(args: {
  ancora: Date
  /** Quando o fato entrou no sistema. `null` quando a fonte não sabe. */
  nasceuEm?: Date | null
  /** Abertura da janela de automações da clínica hoje. */
  janelaAbertaDesde?: Date
  /** O instante do ciclo, quando o chamador quer o corte de nascimento. */
  agora?: Date
}): Date {
  /**
   * Nascimento à FRENTE do ciclo é desconsiderado, nunca respeitado.
   *
   * `created_at` vem do relógio do banco e `agora` do relógio do processo; um
   * adiantamento de segundos entre os dois faria a mensagem esperar mais um
   * ciclo por nada. Pior: o dado é usado para LIBERAR envio, e um valor no
   * futuro o bloquearia — que é exatamente a classe de silêncio que esta
   * correção existe para acabar. Na dúvida, ignora-se o campo e a decisão volta
   * a ser da âncora.
   */
  const nasceu = args.nasceuEm?.getTime() ?? 0
  const nascimento = args.agora && nasceu > args.agora.getTime() ? 0 : nasceu

  return new Date(
    Math.max(args.ancora.getTime(), nascimento, args.janelaAbertaDesde?.getTime() ?? 0),
  )
}

/**
 * Este candidato está devido NESTE ciclo?
 *
 * Substitui o corte que antes era feito só pelo intervalo SQL. A troca é
 * necessária, não estética: `podeDesde` depende de quando cada linha nasceu, e
 * isso não cabe num intervalo sobre a coluna de data do evento. A consulta
 * passou a trazer um superconjunto, e a regra passou a ser esta função — uma
 * só, testável, compartilhada pelas três fontes ancoradas.
 *
 * O intervalo é aberto no início e fechado no fim: um instante exatamente na
 * fronteira pertence a um ciclo só. Fechar os dois lados faria o candidato do
 * minuto exato do corte ser enumerado duas vezes — o UNIQUE do banco recusaria
 * a segunda, mas o trabalho seria pago duas vezes e o log mentiria.
 */
export function devidaAgora(ctx: EnumerateContext, ancora: Date, nasceuEm?: Date | null): boolean {
  const pode = podeDesde({
    ancora,
    nasceuEm,
    janelaAbertaDesde: ctx.janelaAbertaDesde,
    agora: ctx.now,
  })
  if (pode.getTime() > ctx.now.getTime()) return false

  /**
   * O teto de atraso só vale quando o relógio começou a correr NA ÂNCORA — que
   * é o único caso em que o silêncio foi nosso.
   *
   * Quando o candidato foi liberado por outra coisa (a janela abriu, a consulta
   * acabou de ser lançada), ele entra numa fila que escoa a uma mensagem por
   * ciclo, e o teto de meia hora a decaptaria: numa manhã de dez consultas, as
   * quatro últimas voltariam a ser descartadas — o mesmo defeito, com outro
   * disfarce. O freio dessa fila não é o relógio, é `markAutomationRan`: a marca
   * de varredura NÃO avança enquanto sobrar alguém, e no ciclo em que a fila
   * esvazia ela avança e fecha o represado de uma vez.
   *
   * A entrega segue impossível de ficar errada: a consulta que já começou é
   * descartada pela fonte, e a que mudaria de dia civil pelo guarda-corpo de
   * `mesmoDiaCivil`.
   *
   * A prévia fica de fora, pelo mesmo motivo que já a isenta do descarte do
   * atendimento que começou: ela varre o DIA INTEIRO de uma vez para responder
   * "quantos isso pega hoje?". Sob o teto de atraso ela responderia pela última
   * meia hora, e a clínica ligaria às cegas uma automação que vai falar com cem
   * pessoas.
   */
  const puniDemora = !ctx.previewMode && pode.getTime() === ancora.getTime()
  const borda = puniDemora
    ? Math.max(ctx.windowFrom.getTime(), ctx.now.getTime() - ATRASO_MAX_MINUTOS * 60_000)
    : ctx.windowFrom.getTime()
  return pode.getTime() > borda
}

/**
 * A entrega ainda cai no MESMO dia civil que a âncora pretendia?
 *
 * É o guarda-corpo de liberar mensagem represada. O texto de uma automação
 * ancorada costuma ser relativo ao dia — "sua consulta é *hoje* às 10h", "está
 * confirmada sua consulta *Amanhã*" —, e essa palavra foi escrita contando com
 * o dia em que a âncora vence. Entregar no dia seguinte não é mensagem
 * atrasada, é mensagem ERRADA.
 *
 * O caso concreto que isto barra: uma automação de 24 horas cuja consulta de
 * hoje às 20:00 foi lançada hoje de manhã. A âncora venceu ontem às 20:00, o
 * fato nasceu hoje às 10:00, e sem esta checagem o paciente receberia "sua
 * consulta é amanhã" sobre uma consulta que é daqui a dez horas.
 */
export function mesmoDiaCivil(a: Date, b: Date, timezone: string): boolean {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
  return fmt.format(a) === fmt.format(b)
}

/**
 * A janela de eventos que o ciclo precisa TRAZER do banco.
 *
 * Deixou de ser o corte e passou a ser um superconjunto — quem decide é
 * `devidaAgora`. Os dois sentidos têm alcances diferentes porque as perguntas
 * são diferentes:
 *
 * **antes** ("4 horas antes da consulta") traz TODA consulta que ainda vai
 * acontecer dentro da antecedência. É o que faz a consulta lançada em cima da
 * hora ser alcançada: a âncora dela já nasceu vencida, e nenhum intervalo
 * ancorado na varredura anterior a encontraria. O conjunto é pequeno e limitado
 * pela própria antecedência.
 *
 * **depois** ("3 horas depois do atendimento") olha para trás, onde não existe
 * o problema do fato que nasce tarde — mas existe o do silêncio da noite, e por
 * isso o alcance é `ALCANCE_RECUPERACAO_MS`.
 */
export function janelaAncorada(
  ctx: EnumerateContext,
  deslocamentoMin: number,
  sentido: 'antes' | 'depois',
): { de: string; ate: string } {
  const sinal = sentido === 'antes' ? 1 : -1
  const desloc = sinal * deslocamentoMin * 60_000
  const ate = ctx.now.getTime() + desloc

  // A prévia continua medindo exatamente o dia que lhe foi entregue.
  if (ctx.previewMode) {
    return {
      de: new Date(ctx.windowFrom.getTime() + desloc).toISOString(),
      ate: new Date(ate).toISOString(),
    }
  }

  const de =
    sentido === 'antes' ? ctx.now.getTime() : ctx.now.getTime() - ALCANCE_RECUPERACAO_MS + desloc
  return { de: new Date(de).toISOString(), ate: new Date(ate).toISOString() }
}

/**
 * O texto de `{{antecedencia}}` que a mensagem pode afirmar sem mentir.
 *
 * Na operação normal a distância real é a configurada, a menos do escoamento da
 * fila, e o texto continua sendo o da configuração — nenhuma mensagem que já
 * saía muda de palavra. Quando a entrega é de um represado (silêncio da noite,
 * consulta lançada tarde), a distância real é OUTRA, e é ela que vai no texto:
 * a permissividade nova só é defensável porque a mensagem passa a dizer a
 * verdade sobre si mesma.
 */
export function textoAntecedencia(
  configuradoMin: number,
  realMin: number,
  comoAncorada: boolean,
): string {
  if (!comoAncorada) return duracaoTexto(configuradoMin, false)
  if (Math.abs(realMin - configuradoMin) <= ATRASO_MAX_MINUTOS) {
    return duracaoTexto(configuradoMin, true)
  }
  // Abaixo de uma hora a leitura é em minutos; acima, arredonda ao quarto de
  // hora e nunca para uma unidade que esconda o resto — "2 horas" para uma hora
  // e meia seria a mesma classe de mentira que o teto de atraso existe para
  // impedir.
  if (realMin < 60) {
    const minutos = Math.min(55, Math.max(5, Math.round(realMin / 5) * 5))
    return `${minutos} minutos`
  }
  const arredondado = Math.round(realMin / 15) * 15
  const h = Math.floor(arredondado / 60)
  const m = arredondado % 60
  if (m === 0) return `${h} ${h === 1 ? 'hora' : 'horas'}`
  return `${h}h${String(m).padStart(2, '0')}`
}

// ---------------------------------------------------------------------------
// Formatação das variáveis
// ---------------------------------------------------------------------------

export function dataHoraBr(iso: string, timezone: string): string {
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: timezone,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso))
}

export function dataBr(iso: string, timezone: string): string {
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: timezone,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(new Date(iso))
}

/** `YYYY-MM-DD` de coluna `DATE` — sem fuso, porque a coluna não tem. */
export function dataCivilBr(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso)
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso
}

export function horaBr(iso: string, timezone: string): string {
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso))
}

export function moedaBr(centavos: number): string {
  return (centavos / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

/**
 * O primeiro nome do profissional, para a mensagem soar como gente.
 * Mantém o título quando ele já vem no cadastro ("Dra. Ana" continua "Dra. Ana").
 */
export function primeiroNome(completo: string): string {
  const partes = completo.trim().split(/\s+/)
  if (partes.length > 1 && /^(dr|dra|drª)\.?$/i.test(partes[0] ?? '')) {
    return `${partes[0]} ${partes[1]}`
  }
  return partes[0] ?? completo
}
