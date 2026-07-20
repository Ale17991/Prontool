import type { Sex } from './age-sex'
import type { DobraProtocol, TmbEquation } from './protocols'

/**
 * Feature 046 — avisos de domínio de validação.
 *
 * Toda equação de nutrição foi derivada numa população específica. Usá-la fora
 * dessa população não é erro de cálculo — é uso fora do domínio, e quem decide
 * se vale a pena é o profissional, não o software. Por isso estes avisos são
 * NÃO-BLOQUEANTES: o valor é calculado normalmente e a ressalva aparece ao lado.
 *
 * Bloquear aqui seria pior: engessaria o atendimento sem impedir nenhum erro
 * que o profissional não possa julgar melhor que a gente.
 */

export interface Advisory {
  /** Chave estável (para teste e telemetria). */
  code: string
  message: string
}

/** Avisos do bloco de composição corporal. */
export function compositionAdvisories(args: {
  protocol: DobraProtocol
  sex: Sex
  ageYears: number
}): Advisory[] {
  const { protocol, ageYears } = args
  const out: Advisory[] = []

  if (protocol === 'mcardle' && (ageYears < 9 || ageYears > 16)) {
    out.push({
      code: 'MCARDLE_OUT_OF_RANGE',
      message:
        'McArdle foi validada em 9–16 anos. Fora dessa faixa o % de gordura tende a ficar superestimado — considere Jackson-Pollock ou Petroski.',
    })
  }

  if (protocol === 'slaughter') {
    out.push({
      code: 'SLAUGHTER_TANNER_PROXY',
      message:
        'Slaughter estratifica por estágio de Tanner; aqui a maturação é aproximada pela idade. Entre 12 e 14 anos a diferença pode chegar a ~4 pontos percentuais.',
    })
  }

  if (protocol === 'weltman') {
    out.push({
      code: 'WELTMAN_DOMAIN',
      message:
        'Weltman foi derivada em população com obesidade e usa a MÉDIA de duas medidas abdominais. Em pacientes eutróficos ou atletas, tende a desviar.',
    })
  }

  if (protocol === 'durnin_womersley') {
    out.push({
      code: 'DURNIN_GROUPED',
      message:
        'Usando a equação agrupada (todas as idades). Durnin-Womersley também publicou coeficientes por faixa etária, mais precisos nos extremos.',
    })
  }

  return out
}

/** Avisos do bloco de gasto energético. */
export function energyAdvisories(args: {
  equation: TmbEquation
  ageYears: number
}): Advisory[] {
  const { equation, ageYears } = args
  const out: Advisory[] = []

  if (equation === 'tinsley_peso' || equation === 'tinsley_mlg') {
    out.push({
      code: 'TINSLEY_ATHLETES',
      message:
        'Tinsley foi derivada em atletas de físico com baixo % de gordura (n=27). Em paciente sedentário ou com obesidade, superestima.',
    })
  }

  if (equation === 'harris_benedict_1919' || equation === 'harris_benedict_1984') {
    out.push({
      code: 'HARRIS_BENEDICT_OVERESTIMATE',
      message: 'Harris-Benedict tende a superestimar o gasto medido em torno de 5%.',
    })
  }

  if (equation === 'eer_iom_2005' && ageYears < 3) {
    out.push({
      code: 'EER2005_INFANT',
      message:
        'Abaixo de 3 anos o IOM usa equação própria (89 × peso − 100 + depósito). O valor aqui é apenas indicativo.',
    })
  }

  // Henry & Rees (1991) foi ajustada em 3–60 anos. Fora disso o código
  // extrapolava em silêncio — coeficiente certo, população errada, e
  // justamente em pediatria/geriatria, onde o erro de TMB pesa mais.
  if (equation === 'henry_rees' && (ageYears < 3 || ageYears > 60)) {
    out.push({
      code: 'HENRY_REES_OUT_OF_RANGE',
      message:
        'Henry-Rees foi publicada para 3–60 anos. Fora dessa faixa o valor é extrapolação — prefira FAO/WHO ou Schofield.',
    })
  }

  // FAO 2004 readotou as equações de peso de Schofield (1985): para adulto as
  // duas opções devolvem o mesmo número (±0,05 kcal).
  if ((equation === 'fao_who_2004' || equation === 'schofield') && ageYears >= 18) {
    out.push({
      code: 'FAO2004_SCHOFIELD_SAME',
      message:
        'Em adultos, FAO/WHO 2004 e Schofield são a mesma equação (o FAO 2004 readotou as de peso do Schofield) — o resultado é idêntico.',
    })
  }

  // O Schofield adulto implementado é o "peso apenas": a altura é coletada mas
  // não entra na conta. Existe a família peso+altura, ainda não implementada.
  if (equation === 'schofield' && ageYears >= 18) {
    out.push({
      code: 'SCHOFIELD_HEIGHT_UNUSED',
      message: 'Nesta faixa o Schofield usa apenas o peso — a altura informada não entra no cálculo.',
    })
  }

  if (equation === 'cunningham' || equation === 'katch_mcardle') {
    out.push({
      code: 'CUNNINGHAM_LINEAGE',
      message:
        'Cunningham (1980) e a forma conhecida como "Katch-McArdle" (Cunningham, 1991) são revisões da mesma equação — a diferença entre elas não representa escolas distintas.',
    })
  }

  return out
}
