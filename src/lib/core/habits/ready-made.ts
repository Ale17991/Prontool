import type { HabitItem } from './period'

/**
 * Checklists de hábitos prontos — a grade inicial, para a clínica não começar
 * de uma tela em branco.
 *
 * Quarto catálogo no mesmo padrão (anamnese, orientações e documentos são os
 * outros): conteúdo em código, aplicado por CÓPIA. Ao aplicar num paciente os
 * itens viram a grade DELE — remover ou acrescentar hábito ali não mexe no
 * modelo, e melhorar o catálogo depois não reescreve grade nenhuma.
 *
 * Os hábitos são escritos como PERGUNTA de sim ou não, e não como rótulo seco
 * ("Água"). A pergunta dá o critério: quem lê "Bebeu pelo menos 2 litros de
 * água?" sabe quando marcar; quem lê "Água" marca pelo que achar que conta.
 */

export interface ReadyMadeChecklist {
  slug: string
  title: string
  /** Uma linha explicando para quem serve. */
  hint: string
  items: HabitItem[]
}

/**
 * Transcrito dos arquivos `RS. Check List F.xlsx` / `M.xlsx`. O conteúdo dos
 * dois é IDÊNTICO — a diferença entre eles é só visual, então não se separa por
 * sexo. A primeira aba tem 5 hábitos; a segunda acrescenta álcool.
 */
const BASICO: ReadyMadeChecklist = {
  slug: 'habitos-basico',
  title: 'Hábitos básicos',
  hint: 'Cinco hábitos do dia a dia. Bom ponto de partida.',
  items: [
    { id: 'alimentacao', label: 'Seguiu o plano alimentar hoje?' },
    { id: 'treino', label: 'Fez atividade física hoje?' },
    { id: 'sono', label: 'Dormiu pelo menos 7 horas?' },
    { id: 'agua', label: 'Bebeu pelo menos 2 litros de água?' },
    { id: 'doce', label: 'Passou o dia sem doce?' },
  ],
}

const COMPLETO: ReadyMadeChecklist = {
  slug: 'habitos-completo',
  title: 'Hábitos completos',
  hint: 'O básico mais álcool e ultraprocessados.',
  items: [
    ...BASICO.items.map((i) => ({ ...i })),
    { id: 'alcool', label: 'Passou o dia sem bebida alcoólica?' },
    { id: 'ultraprocessados', label: 'Passou o dia sem ultraprocessados?' },
  ],
}

const INTESTINO: ReadyMadeChecklist = {
  slug: 'habitos-intestino',
  title: 'Saúde intestinal',
  hint: 'Para acompanhar fibras, hidratação e funcionamento.',
  items: [
    { id: 'evacuacao', label: 'Evacuou hoje?' },
    { id: 'fibras', label: 'Comeu frutas, verduras ou legumes em todas as refeições principais?' },
    { id: 'agua', label: 'Bebeu pelo menos 2 litros de água?' },
    { id: 'mastigacao', label: 'Comeu devagar, sem pressa e sem tela?' },
    { id: 'atividade', label: 'Se movimentou hoje (caminhada conta)?' },
  ],
}

const GESTANTE: ReadyMadeChecklist = {
  slug: 'habitos-gestante',
  title: 'Gestação',
  hint: 'Acompanhamento no pré-natal.',
  items: [
    { id: 'suplemento', label: 'Tomou a suplementação prescrita?' },
    { id: 'refeicoes', label: 'Fez todas as refeições do plano?' },
    { id: 'agua', label: 'Bebeu pelo menos 2 litros de água?' },
    { id: 'movimento', label: 'Se movimentou hoje, dentro do que foi liberado?' },
    { id: 'sono', label: 'Descansou o suficiente?' },
    { id: 'sem_alcool', label: 'Passou o dia sem álcool e sem cigarro?' },
  ],
}

export const READY_MADE_CHECKLISTS: readonly ReadyMadeChecklist[] = [
  BASICO,
  COMPLETO,
  INTESTINO,
  GESTANTE,
]

export function readyMadeChecklist(slug: string): ReadyMadeChecklist | undefined {
  return READY_MADE_CHECKLISTS.find((c) => c.slug === slug)
}
