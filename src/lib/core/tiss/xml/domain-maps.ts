/**
 * Feature 029 (US2) — mapeamentos de dados internos → códigos de domínio TISS.
 *
 * O XSD 04.03.00 exige CÓDIGOS de domínio, não rótulos:
 *  - `dm_conselhoProfissional` (dom. 26): "06" = CRM, não a string "CRM".
 *  - `dm_UF` (dom. 59): código IBGE de 2 dígitos — "35" = SP, não "SP".
 *  - `dm_CBOS` (dom. 24): código CBO de 6 dígitos — já armazenado em `doctors.cbo`.
 *
 * Estes mapas são a ponte entre o cadastro do profissional (CRM/SP) e o XML.
 * Fonte: enumerações dos XSDs oficiais + tabela IBGE de UF.
 */

/** Conselho profissional (sigla cadastrada) → código `dm_conselhoProfissional` (dom. 26). */
const CONSELHO_TO_CODE: Record<string, string> = {
  CRESS: '01',
  COREN: '02',
  CRF: '03',
  CRFA: '04',
  CREFITO: '05',
  CRM: '06',
  CRN: '07',
  CRO: '08',
  CRP: '09',
  CRBM: '10',
  CRBio: '11',
  CRTR: '12',
  // 13–15 reservados na ANS; siglas menos comuns adicionadas conforme necessário.
}

/** UF (sigla) → código IBGE de 2 dígitos exigido por `dm_UF` (dom. 59). */
const UF_TO_IBGE: Record<string, string> = {
  RO: '11',
  AC: '12',
  AM: '13',
  RR: '14',
  PA: '15',
  AP: '16',
  TO: '17',
  MA: '21',
  PI: '22',
  CE: '23',
  RN: '24',
  PB: '25',
  PE: '26',
  AL: '27',
  SE: '28',
  BA: '29',
  MG: '31',
  ES: '32',
  RJ: '33',
  SP: '35',
  PR: '41',
  SC: '42',
  RS: '43',
  MS: '50',
  MT: '51',
  GO: '52',
  DF: '53',
}

/**
 * Converte a sigla do conselho (ex.: "CRM") no código de domínio 26.
 * Retorna `null` se a sigla não estiver mapeada (vira pendência de validação).
 */
export function conselhoToCode(council: string | null | undefined): string | null {
  if (!council) return null
  return CONSELHO_TO_CODE[council.trim().toUpperCase()] ?? null
}

/**
 * Converte a sigla da UF (ex.: "SP") no código IBGE exigido por `dm_UF`.
 * Aceita já-código (2 dígitos) por idempotência. Retorna `null` se desconhecida.
 */
export function ufToIbgeCode(uf: string | null | undefined): string | null {
  if (!uf) return null
  const trimmed = uf.trim().toUpperCase()
  if (/^\d{2}$/.test(trimmed)) return trimmed
  return UF_TO_IBGE[trimmed] ?? null
}
