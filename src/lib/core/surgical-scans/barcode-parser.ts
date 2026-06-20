/**
 * Backlog 1/4/3 — parser de código de barras de material (GS1).
 * Application Identifiers tratados: (01) GTIN, (10) lote, (17) validade YYMMDD,
 * (21) serial. Suporta a forma concatenada (com separador FNC1 = GS \x1d) e a
 * forma com parênteses legível.
 */

export type BarcodeFormat = 'gs1_datamatrix' | 'gs1_128' | 'ean13' | 'qr' | 'manual'

export interface ParsedGs1 {
  gtin?: string
  lot?: string
  expiry?: string | null // YYYY-MM-DD
  serial?: string
}

export interface ParsedBarcode extends ParsedGs1 {
  format: BarcodeFormat
}

const GS = '\x1d' // FNC1 / group separator
const FIXED_LEN: Record<string, number> = { '01': 14, '17': 6 }

/** YYMMDD → YYYY-MM-DD (DD=00 → dia 01, convenção GS1 "fim do mês" simplificada). */
function gs1DateToIso(yymmdd: string): string | null {
  if (!/^\d{6}$/.test(yymmdd)) return null
  const yy = Number(yymmdd.slice(0, 2))
  const mm = yymmdd.slice(2, 4)
  let dd = yymmdd.slice(4, 6)
  if (dd === '00') dd = '01'
  const yyyy = 2000 + yy
  if (Number(mm) < 1 || Number(mm) > 12) return null
  return `${yyyy}-${mm}-${dd}`
}

function mapAi(out: ParsedGs1, ai: string, value: string) {
  if (ai === '01') out.gtin = value
  else if (ai === '10') out.lot = value
  else if (ai === '17') out.expiry = gs1DateToIso(value)
  else if (ai === '21') out.serial = value
}

/** Parser comum GS1 (DataMatrix e 128 usam a mesma codificação de AIs). */
function parseGs1Common(raw: string): ParsedGs1 | null {
  let s = raw.trim()
  // Remove identificador de simbologia AIM (]d2, ]C1) e FNC1 inicial.
  s = s.replace(/^\][A-Za-z]\d/, '')
  while (s.startsWith(GS)) s = s.slice(1)

  const out: ParsedGs1 = {}

  // Forma com parênteses: (01)...(10)...
  if (s.includes('(')) {
    const re = /\((\d{2,4})\)([^(]*)/g
    let m: RegExpExecArray | null
    let matched = false
    while ((m = re.exec(s)) !== null) {
      matched = true
      mapAi(out, m[1]!, (m[2] ?? '').split(GS).join('').trim())
    }
    return matched ? out : null
  }

  // Forma concatenada com FNC1.
  let i = 0
  let matched = false
  while (i < s.length) {
    const ai = s.slice(i, i + 2)
    if (!/^\d{2}$/.test(ai)) break
    i += 2
    let value: string
    const fixed = FIXED_LEN[ai]
    if (fixed) {
      value = s.slice(i, i + fixed)
      i += fixed
    } else {
      const gsIdx = s.indexOf(GS, i)
      const end = gsIdx === -1 ? s.length : gsIdx
      value = s.slice(i, end)
      i = gsIdx === -1 ? s.length : gsIdx + 1
    }
    if (!value) break
    mapAi(out, ai, value)
    matched = true
    if (!fixed && i >= s.length) break
  }
  return matched && (out.gtin || out.lot || out.expiry || out.serial) ? out : null
}

export function parseGS1DataMatrix(raw: string): ParsedGs1 | null {
  return parseGs1Common(raw)
}

export function parseGS1128(raw: string): ParsedGs1 | null {
  return parseGs1Common(raw)
}

/** Dispatcher — decide o formato e extrai o que der. */
export function parseBarcode(raw: string): ParsedBarcode {
  const s = raw.trim()
  // EAN-13 puro (sem AIs).
  if (/^\d{13}$/.test(s)) {
    return { format: 'ean13', gtin: s }
  }
  const gs1 = parseGs1Common(s)
  if (gs1) {
    return { format: 'gs1_datamatrix', ...gs1 }
  }
  // Conteúdo não reconhecido como GS1 → trata como QR/string livre.
  return { format: 'qr' }
}
