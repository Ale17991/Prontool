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
export function janelaDoDia(
  diaCivil: string,
  timezone: string,
): { de: string; ate: string } {
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
