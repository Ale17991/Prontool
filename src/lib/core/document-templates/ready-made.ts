/**
 * Modelos de documento prontos — a biblioteca inicial da clínica.
 *
 * Terceiro catálogo no mesmo padrão (anamnese e orientações são os outros):
 * conteúdo editorial em código, instalado por CÓPIA. Instalar cria um modelo
 * normal do tenant, que a clínica edita à vontade; melhorar o catálogo depois
 * não reescreve o que já foi instalado nem os documentos já emitidos.
 *
 * Por que isto importa aqui mais do que nos outros: emitir documento com o
 * texto errado é problema jurídico, não estético. Um atestado sem o período de
 * afastamento ou uma declaração sem horário não servem para nada — e é
 * exatamente o que a pessoa descobre na hora de entregar.
 *
 * ⚠️ Estes textos são ponto de partida. Atestado e declaração têm exigências
 * de conselho profissional (identificação, CID mediante autorização do
 * paciente, assinatura) que variam por categoria — a clínica ajusta ao seu
 * caso antes de usar.
 */

export type DocType = 'atestado' | 'declaracao' | 'receita' | 'laudo' | 'outro'
export type PaperSize = 'A4' | 'A5' | 'LETTER'

export interface ReadyMadeDocument {
  slug: string
  name: string
  docType: DocType
  paperSize: PaperSize
  fontSize: number
  /** Uma linha explicando quando usar. */
  hint: string
  body: string
}

const ATESTADO = [
  'ATESTADO',
  '',
  'Atesto, para os devidos fins, que {{paciente.nome}}, portador(a) do CPF {{paciente.cpf}}, esteve sob meus cuidados profissionais nesta data e necessita de afastamento de suas atividades por ____ (______) dias, a partir de ____/____/______.',
  '',
  'CID: ____________  (informado mediante autorização expressa do(a) paciente)',
  '',
  '{{clinica.nome}}, {{data}}.',
  '',
  '',
  '_______________________________________',
  'Assinatura e carimbo do profissional',
].join('\n')

const DECLARACAO_COMPARECIMENTO = [
  'DECLARAÇÃO DE COMPARECIMENTO',
  '',
  'Declaro, para os devidos fins, que {{paciente.nome}}, portador(a) do CPF {{paciente.cpf}}, compareceu a esta unidade para atendimento no dia {{data}}, no período das ______ às ______ horas.',
  '',
  // Sem horário a declaração não cumpre a função dela — que é justificar o
  // tempo de ausência do trabalho ou da escola.
  'Esta declaração destina-se à comprovação de comparecimento e não configura atestado de afastamento.',
  '',
  '{{clinica.nome}}, {{data}}.',
  '',
  '',
  '_______________________________________',
  'Assinatura e carimbo do profissional',
].join('\n')

const DECLARACAO_ACOMPANHANTE = [
  'DECLARAÇÃO DE ACOMPANHANTE',
  '',
  'Declaro, para os devidos fins, que o(a) Sr.(a) ______________________________________ acompanhou {{paciente.nome}}, portador(a) do CPF {{paciente.cpf}}, em atendimento nesta unidade no dia {{data}}, no período das ______ às ______ horas.',
  '',
  '{{clinica.nome}}, {{data}}.',
  '',
  '',
  '_______________________________________',
  'Assinatura e carimbo do profissional',
].join('\n')

const ENCAMINHAMENTO = [
  'ENCAMINHAMENTO',
  '',
  'Encaminho o(a) paciente {{paciente.nome}}, {{paciente.idade}}, portador(a) do CPF {{paciente.cpf}}, para avaliação em ______________________________________.',
  '',
  'Motivo do encaminhamento:',
  '________________________________________________________________',
  '________________________________________________________________',
  '',
  'Condutas e exames já realizados:',
  '________________________________________________________________',
  '________________________________________________________________',
  '',
  'Coloco-me à disposição para as informações que se fizerem necessárias.',
  '',
  '{{clinica.nome}}, {{data}}.',
  '',
  '',
  '_______________________________________',
  'Assinatura e carimbo do profissional',
].join('\n')

const CONSENTIMENTO = [
  'TERMO DE CONSENTIMENTO LIVRE E ESCLARECIDO',
  '',
  'Eu, {{paciente.nome}}, portador(a) do CPF {{paciente.cpf}}, declaro que fui esclarecido(a), em linguagem que compreendi, sobre o procedimento/tratamento proposto:',
  '',
  '________________________________________________________________',
  '',
  'Foram explicados a mim:',
  '• o objetivo do procedimento e o resultado que se espera dele;',
  '• como ele é realizado e quanto tempo costuma levar;',
  '• os riscos e as complicações possíveis, ainda que raros;',
  '• as alternativas existentes, incluindo a de não realizar o procedimento;',
  '• os cuidados que preciso ter antes e depois.',
  '',
  'Tive oportunidade de fazer perguntas e todas foram respondidas. Estou ciente de que posso retirar este consentimento a qualquer momento, antes ou durante o tratamento, sem que isso prejudique meu atendimento.',
  '',
  '{{clinica.nome}}, {{data}}.',
  '',
  '',
  '_______________________________________',
  'Paciente ou responsável legal',
  '',
  '',
  '_______________________________________',
  'Assinatura e carimbo do profissional',
].join('\n')

const ORIENTACAO_JEJUM = [
  'ORIENTAÇÕES PARA COLETA DE EXAMES',
  '',
  'Paciente: {{paciente.nome}}',
  'Data da coleta: ____/____/______   Horário: ______',
  '',
  'Antes da coleta:',
  '• Jejum de ______ horas. Água pode, e é bem-vinda.',
  '• Mantenha sua alimentação habitual nos três dias anteriores. Dieta diferente do normal altera o resultado e atrapalha a interpretação.',
  '• Evite bebida alcoólica nas 72 horas anteriores.',
  '• Evite exercício físico intenso nas 24 horas anteriores.',
  '',
  'Sobre seus medicamentos:',
  '• NÃO suspenda nenhum medicamento por conta própria. Se algum precisar ser interrompido, eu aviso.',
  '• Leve a lista do que você usa, com dose e horário.',
  '',
  'No dia:',
  '• Leve documento com foto e o pedido do exame.',
  '• Se passar mal durante a coleta, avise a equipe imediatamente.',
  '',
  'Qualquer dúvida, entre em contato antes da data.',
  '',
  '{{clinica.nome}}',
].join('\n')

export const READY_MADE_DOCUMENTS: readonly ReadyMadeDocument[] = [
  {
    slug: 'atestado-simples',
    name: 'Atestado',
    docType: 'atestado',
    paperSize: 'A5',
    fontSize: 12,
    hint: 'Afastamento por dias, com espaço para CID.',
    body: ATESTADO,
  },
  {
    slug: 'declaracao-comparecimento',
    name: 'Declaração de comparecimento',
    docType: 'declaracao',
    paperSize: 'A5',
    fontSize: 12,
    hint: 'Comprova o horário do atendimento. Não é afastamento.',
    body: DECLARACAO_COMPARECIMENTO,
  },
  {
    slug: 'declaracao-acompanhante',
    name: 'Declaração de acompanhante',
    docType: 'declaracao',
    paperSize: 'A5',
    fontSize: 12,
    hint: 'Para quem acompanhou o paciente na consulta.',
    body: DECLARACAO_ACOMPANHANTE,
  },
  {
    slug: 'encaminhamento',
    name: 'Encaminhamento',
    docType: 'outro',
    paperSize: 'A4',
    fontSize: 11,
    hint: 'Envio a outro profissional, com motivo e histórico.',
    body: ENCAMINHAMENTO,
  },
  {
    slug: 'consentimento',
    name: 'Termo de consentimento',
    docType: 'outro',
    paperSize: 'A4',
    fontSize: 11,
    hint: 'Consentimento livre e esclarecido, com assinatura do paciente.',
    body: CONSENTIMENTO,
  },
  {
    slug: 'orientacao-jejum',
    name: 'Orientações para coleta de exames',
    docType: 'outro',
    paperSize: 'A4',
    fontSize: 11,
    hint: 'Preparo do paciente antes da coleta.',
    body: ORIENTACAO_JEJUM,
  },
]

export function readyMadeDocument(slug: string): ReadyMadeDocument | undefined {
  return READY_MADE_DOCUMENTS.find((d) => d.slug === slug)
}
