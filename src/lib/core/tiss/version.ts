/**
 * Feature 029 — Faturamento TISS de convênios.
 *
 * Constantes da versão-alvo do Padrão TISS, confirmadas no release oficial da
 * ANS de **Maio/2026** (`PadroTISS_ComponenteOrganizacional_202605.pdf`, o mais
 * recente — pub. 28/05/2026). A RN 501/2022 (Art. 7) obriga uso da "versão
 * vigente": estes valores são a fonte única de verdade da versão no código.
 *
 * Ao subir um novo release da ANS, atualizar AQUI + rebaixar os XSDs em
 * `schemas/<versão>/` na mesma PR (Princípio IV — conformidade TUSS/ANS).
 */

/** Componente de Comunicação (mensagens) — versão das mensagens XML/XSD. */
export const TISS_VERSION = '04.03.00' as const

/** Componente de Conteúdo e Estrutura — legenda de campos/obrigatoriedade das guias. */
export const CONTEUDO_ESTRUTURA_VERSION = '202511' as const

/** Componente de Representação de Conceitos em Saúde (TUSS). */
export const TUSS_VERSION = '202605' as const

/** Componente de Segurança e Privacidade. */
export const SEGURANCA_PRIVACIDADE_VERSION = '202511' as const

/** Fim de implantação obrigatório da 04.03.00 (informativo). */
export const TISS_VERSION_FIM_IMPLANTACAO = '2026-06-30' as const

/** Namespace alvo dos schemas TISS da ANS. */
export const TISS_NAMESPACE = 'http://www.ans.gov.br/padroes/tiss/schemas' as const

/** Diretório (relativo a esta cápsula) onde vivem os XSDs oficiais da versão-alvo. */
export const TISS_SCHEMAS_DIR = `schemas/${TISS_VERSION}` as const

/**
 * Tabelas de domínio TISS que o sistema referencia (confirmadas na legenda
 * oficial 202511). Usadas para seed e validação de conteúdo.
 *  38 = Mensagens (glosas, negativas e outras)
 *  87 = Tabela de tabelas (referência do procedimento/item)
 *  26 = Conselho profissional · 24 = CBO · 59 = UF
 *  52 = Tipo de consulta · 36 = Indicação de acidente
 *  48 = Técnica utilizada (SP/SADT) · 50 = Tipo de atendimento
 *  23 = Caráter do atendimento · 76 = Regime de atendimento
 *  35 = Grau de participação do profissional
 */
export const TISS_DOMAIN_NUMBERS = [
  '38',
  '87',
  '26',
  '24',
  '59',
  '52',
  '36',
  '48',
  '50',
  '23',
  '76',
  '35',
] as const

export type TissDomainNumber = (typeof TISS_DOMAIN_NUMBERS)[number]
