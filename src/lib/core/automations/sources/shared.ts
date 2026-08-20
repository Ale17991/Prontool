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
 * Quanto uma mensagem ancorada pode chegar ATRASADA, em minutos.
 *
 * Nasceu de um caso real medido em produção (20/08/2026): uma automação de "4
 * horas antes da consulta" entregou mensagens 1h30 antes. A causa é a soma de
 * duas proteções que não conversavam. A janela de silêncio (08:00–20:00) guarda
 * a noite inteira; às 08:00 o ciclo perguntava "que âncoras venceram nas últimas
 * SEIS horas" e despejava todas de uma vez; e o teto de uma mensagem a cada 5
 * minutos escoava a fila devagar. A consulta das 10:20, cuja hora de avisar era
 * 06:20, saía 08:50 — com o texto dizendo "4 horas" e a verdade sendo 1h30.
 *
 * A mensagem afirma uma distância. Entregar fora dela não é atraso, é informação
 * falsa no celular do paciente — e por isso o que passa do teto é DESCARTADO em
 * silêncio, e não enfileirado. É a mesma doutrina que já governava o teto de 6h
 * de varredura ("a hora dela passou e não volta"); o que muda é o número, que ali
 * dimensionava sobreviver a um deploy ruim e aqui dimensiona não mentir.
 *
 * Trinta minutos, e não cinco, porque o escoamento é parte da operação normal:
 * com uma mensagem por ciclo de 5 minutos, seis âncoras que vencem juntas levam
 * meia hora para sair. Um teto menor mataria a cauda de todo lote — trocaria a
 * mensagem errada pela mensagem que nunca chega.
 */
export const ATRASO_MAX_MINUTOS = 30

/**
 * A janela de instantes de ÂNCORA que vencem neste ciclo.
 *
 * O ciclo pergunta "o que aconteceu (ou vai acontecer) e cuja hora de avisar
 * caiu entre a varredura anterior e agora". Para uma antecedência de 2 horas, a
 * hora de avisar de uma consulta das 16h é 14h — então às 14h05 o ciclo procura
 * consultas marcadas entre 16h e 16h15, e não consultas marcadas agora.
 *
 * O intervalo é aberto no início e fechado no fim: uma âncora exatamente na
 * fronteira pertence a um ciclo só. Fechar os dois lados faria a consulta que
 * cai no minuto exato do corte ser enumerada duas vezes — o UNIQUE do banco
 * recusaria a segunda, mas o trabalho seria pago duas vezes e o log mentiria.
 */
export function janelaAncorada(
  ctx: EnumerateContext,
  deslocamentoMin: number,
  sentido: 'antes' | 'depois',
): { de: string; ate: string } {
  const sinal = sentido === 'antes' ? 1 : -1
  const desloc = sinal * deslocamentoMin * 60_000
  // O atraso de uma mensagem ancorada é EXATAMENTE o tamanho desta janela: quem
  // entra pela borda de trás teve a sua âncora vencida há `now - windowFrom`.
  // Limitar a borda de trás é, portanto, limitar a mentira. Ver ATRASO_MAX_MINUTOS.
  //
  // A prévia fica de fora, pelo mesmo motivo que já a isenta do descarte do
  // atendimento que começou: ela varre o DIA INTEIRO de uma vez para responder
  // "quantos isso pega hoje?". Aplicar aqui o teto de atraso encolheria a
  // pergunta do dia para meia hora, e a clínica veria "1 paciente" antes de
  // ligar uma automação que vai falar com cem.
  const bordaDeTras = ctx.previewMode
    ? ctx.windowFrom.getTime()
    : Math.max(ctx.windowFrom.getTime(), ctx.now.getTime() - ATRASO_MAX_MINUTOS * 60_000)
  return {
    de: new Date(bordaDeTras + desloc).toISOString(),
    ate: new Date(ctx.now.getTime() + desloc).toISOString(),
  }
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
