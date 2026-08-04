/**
 * Feature 053 — a rede contra mensagem acusatória (FR-008).
 *
 * O sistema NUNCA sabe que o paciente deixou de fazer algo. Sabe apenas que não
 * viu registro — `habit_checklist_marks` não tem coluna "não fez", e desmarcar
 * apaga a linha. Como a mensagem vai direto ao paciente, afirmar "você não
 * bebeu água há 5 dias" para quem bebeu e não registrou é uma acusação falsa
 * vinda da clínica em que ele confia.
 *
 * ---
 *
 * SOBRE O QUE ESTA LISTA GARANTE, dito com todas as letras: ela pega DESCUIDO,
 * não má-fé. Uma clínica determinada escreve acusação com outras palavras e
 * passa. A garantia real está nos textos padrão do catálogo, que são nossos,
 * revisados e cobertos por teste. O valor desta camada é tornar o caminho
 * acusatório trabalhoso — que é o que muda comportamento em produto.
 *
 * Quem ler FR-008 esperando barreira forte vai se decepcionar; por isso o
 * limite está escrito aqui e no research (D9), e não escondido.
 *
 * Não se aplica a famílias de CELEBRAÇÃO: não há como acusar alguém de algo que
 * ele fez.
 */

interface ForbiddenPhrase {
  /** Regex sem âncora, case-insensitive, tolerante a acento ausente. */
  pattern: RegExp
  /** O que a clínica deveria escrever no lugar. Vai na mensagem de erro. */
  sugestao: string
}

/**
 * Cobrem a forma "você + verbo de falha" e a forma impessoal equivalente. O
 * pronome é opcional em todas porque "não fez o exercício" acusa igual a "você
 * não fez o exercício".
 */
const FORBIDDEN: readonly ForbiddenPhrase[] = [
  {
    pattern: /\b(voc[êe]\s+)?n[ãa]o\s+fez\b/i,
    sugestao: 'Prefira "não vimos seu registro".',
  },
  {
    pattern: /\b(voc[êe]\s+)?deixou\s+de\b/i,
    sugestao: 'Prefira "não encontramos registro de".',
  },
  {
    pattern: /\b(voc[êe]\s+)?n[ãa]o\s+cumpriu\b/i,
    sugestao: 'Prefira "não vimos a marcação".',
  },
  {
    pattern: /\b(voc[êe]\s+)?falhou\b/i,
    sugestao: 'Evite atribuir falha ao paciente.',
  },
  {
    pattern: /\b(voc[êe]\s+)?(se\s+)?esqueceu\b/i,
    sugestao: 'Prefira "caso tenha faltado marcar".',
  },
  {
    pattern: /\b(voc[êe]\s+)?n[ãa]o\s+seguiu\b/i,
    sugestao: 'Prefira "não vimos registro do plano".',
  },
  {
    pattern: /\b(voc[êe]\s+)?abandonou\b/i,
    sugestao: 'Evite afirmar abandono — pode ser só falta de registro.',
  },
  {
    pattern: /\b(voc[êe]\s+)?desistiu\b/i,
    sugestao: 'Evite afirmar desistência.',
  },
  {
    pattern: /\b(voc[êe]\s+)?n[ãa]o\s+(tem\s+)?se\s+(esfor[çc]|dedic)/i,
    sugestao: 'Evite julgar o empenho do paciente.',
  },
  {
    pattern: /\b(voc[êe]\s+)?n[ãa]o\s+est[áa]\s+(fazendo|cumprindo|seguindo)\b/i,
    sugestao: 'Prefira falar do registro, não da conduta.',
  },
  {
    pattern: /\bn[ãa]o\s+(bebeu|comeu|treinou|caminhou|tomou)\b/i,
    sugestao: 'Prefira "não vimos o registro de".',
  },
  {
    pattern: /\b(est[áa]|anda)\s+(negligenciando|relaxando)\b/i,
    sugestao: 'Evite julgar a conduta do paciente.',
  },
]

export interface ForbiddenPhraseHit {
  /** O trecho exato encontrado no texto, para a mensagem de erro apontá-lo. */
  trecho: string
  sugestao: string
}

/**
 * Devolve a PRIMEIRA ocorrência acusatória, ou `null`. Primeira e não todas de
 * propósito: apontar uma frase por vez faz a clínica reescrever com atenção;
 * uma lista de doze erros faz ela procurar como desligar a validação.
 */
export function findForbiddenPhrase(texto: string): ForbiddenPhraseHit | null {
  for (const { pattern, sugestao } of FORBIDDEN) {
    const m = pattern.exec(texto)
    if (m) return { trecho: m[0], sugestao }
  }
  return null
}

/** Conveniência para teste e para o guard do catálogo. */
export function hasForbiddenPhrase(texto: string): boolean {
  return findForbiddenPhrase(texto) !== null
}

/** Exportada para o teste conseguir provar que a lista não esvaziou. */
export const FORBIDDEN_COUNT = FORBIDDEN.length
