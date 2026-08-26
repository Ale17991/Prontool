/**
 * Feature 056 — ponto de import das fontes.
 *
 * Cada fonte se registra no próprio módulo, então basta importá-la para ela
 * existir. Este arquivo existe só para garantir que ninguém seja esquecido, e é
 * o ÚNICO lugar do código que lista as fontes nominalmente — nem o registro nem
 * o motor sabem quais existem.
 *
 * Ao absorver o lembrete de consulta (FR-025), a mudança é uma linha aqui e um
 * arquivo novo ao lado. Nada mais.
 */

import './aniversario'
import './cadastro'
import './checklist'
import './agenda'
import './acompanhamento'
import './financeiro'
import './tratamento'
import './portal'

export { getSource, listSources } from './registry'
