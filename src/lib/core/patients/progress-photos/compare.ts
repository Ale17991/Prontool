/**
 * Montagem automática do antes/depois.
 *
 * A clínica pediu dois pares, e os dois respondem a perguntas diferentes:
 * "primeira × última" é o resultado do tratamento inteiro, e é o que se mostra
 * ao paciente; "primeira × anterior" é o que mudou desde a última consulta, e é
 * o que se olha para decidir a conduta de hoje.
 *
 * Tudo aqui é função pura sobre a lista já lida do banco — nenhum par sai de
 * consulta SQL. Assim a regra é testável sem storage e sem sessão, e a mesma
 * função serve à tela e ao impresso.
 */

export const PHOTO_ANGLES = [
  'frente',
  'perfil_direito',
  'perfil_esquerdo',
  'costas',
  'outro',
] as const

export type PhotoAngle = (typeof PHOTO_ANGLES)[number]

export const PHOTO_ANGLE_LABEL: Record<PhotoAngle, string> = {
  frente: 'Frente',
  perfil_direito: 'Perfil direito',
  perfil_esquerdo: 'Perfil esquerdo',
  costas: 'Costas',
  outro: 'Outro',
}

export interface ProgressPhoto {
  id: string
  angle: PhotoAngle
  /** `YYYY-MM-DD` — coluna DATE, sem fuso. */
  takenOn: string
  note: string | null
  signedUrl: string | null
}

export interface PhotoPair {
  /** `resultado` = primeira × última; `recente` = primeira × anterior. */
  kind: 'resultado' | 'recente'
  label: string
  before: ProgressPhoto
  after: ProgressPhoto
  /** Distância entre as duas fotos, já escrita ("6 meses", "3 semanas"). */
  interval: string
}

export interface AngleSeries {
  angle: PhotoAngle
  label: string
  /** Ordenada da mais antiga para a mais recente. */
  photos: ProgressPhoto[]
  pairs: PhotoPair[]
}

/** Ordena por data e, no empate, por id — para a ordem não variar entre leituras. */
function chronological(photos: ProgressPhoto[]): ProgressPhoto[] {
  return [...photos].sort((a, b) =>
    a.takenOn === b.takenOn ? a.id.localeCompare(b.id) : a.takenOn.localeCompare(b.takenOn),
  )
}

/**
 * Distância entre duas datas `YYYY-MM-DD`, em português e na maior unidade que
 * ainda descreve o intervalo. "180 dias" é verdade e não diz nada; "6 meses" é
 * a mesma informação na unidade em que a clínica e o paciente pensam.
 *
 * Conta dias corridos e converte por aproximação: o número existe para
 * legendar uma foto, não para calcular idade gestacional.
 */
export function describeInterval(fromYmd: string, toYmd: string): string {
  const from = Date.parse(`${fromYmd}T00:00:00Z`)
  const to = Date.parse(`${toYmd}T00:00:00Z`)
  if (Number.isNaN(from) || Number.isNaN(to)) return '—'

  const days = Math.round((to - from) / 86_400_000)
  if (days <= 0) return 'mesmo dia'
  if (days === 1) return '1 dia'
  if (days < 14) return `${days} dias`

  const weeks = Math.round(days / 7)
  if (days < 60) return weeks === 1 ? '1 semana' : `${weeks} semanas`

  // Daqui para baixo o corte é em MESES, nunca em dias. Cortar o ano em
  // `days < 365` deixava 365 dias exatos cair na conta de anos com
  // `Math.floor(365 / 365.25) = 0`, e a legenda saía "0 anos e 12 meses".
  const months = Math.round(days / 30.44)
  if (months < 12) return months === 1 ? '1 mês' : `${months} meses`

  const years = Math.floor(months / 12)
  const restMonths = months % 12
  const yearPart = years === 1 ? '1 ano' : `${years} anos`
  if (restMonths <= 0) return yearPart
  return `${yearPart} e ${restMonths === 1 ? '1 mês' : `${restMonths} meses`}`
}

/**
 * Os pares de UMA série (um ângulo). Devolve vazio com menos de duas fotos —
 * uma foto sozinha não é evolução, e inventar um par comparando a foto com ela
 * mesma daria uma montagem que afirma que nada mudou.
 */
export function buildPairs(photos: ProgressPhoto[]): PhotoPair[] {
  const ordered = chronological(photos)
  if (ordered.length < 2) return []

  const first = ordered[0]
  const last = ordered[ordered.length - 1]
  // `noUncheckedIndexedAccess`: o length já garante, mas quem lê o tipo não vê.
  if (!first || !last) return []

  const pairs: PhotoPair[] = [
    {
      kind: 'resultado',
      label: 'Primeira × última',
      before: first,
      after: last,
      interval: describeInterval(first.takenOn, last.takenOn),
    },
  ]

  // Com exatamente duas fotos, "a anterior" É a primeira: o segundo par
  // repetiria o primeiro, e duas montagens idênticas lado a lado passam a
  // impressão de que uma delas está errada.
  const previous = ordered.length >= 3 ? ordered[ordered.length - 2] : undefined
  if (previous) {
    pairs.push({
      kind: 'recente',
      label: 'Primeira × anterior',
      before: first,
      after: previous,
      interval: describeInterval(first.takenOn, previous.takenOn),
    })
  }

  return pairs
}

/**
 * Agrupa a coleção do paciente por ângulo e monta os pares de cada um.
 *
 * Ângulo sem foto nenhuma não vira série vazia: a tela mostraria cinco caixas
 * vazias para quem só fotografa de frente. A ordem das séries é a de
 * `PHOTO_ANGLES`, e não a de chegada, para duas leituras do mesmo paciente não
 * saírem em ordens diferentes.
 */
export function buildSeries(photos: ProgressPhoto[]): AngleSeries[] {
  return PHOTO_ANGLES.map((angle) => {
    const ofAngle = chronological(photos.filter((p) => p.angle === angle))
    return {
      angle,
      label: PHOTO_ANGLE_LABEL[angle],
      photos: ofAngle,
      pairs: buildPairs(ofAngle),
    }
  }).filter((series) => series.photos.length > 0)
}
