/**
 * Orientações prontas — textos que a profissional insere com um clique e edita
 * antes de enviar ao paciente.
 *
 * Mesmo padrão dos modelos de anamnese: catálogo em código, porque é conteúdo
 * editorial nosso e não dado de clínica nenhuma. Inserir é uma CÓPIA para o
 * campo de texto — a profissional ajusta o que quiser antes de salvar, e a
 * orientação gravada é dela, não nossa. Melhorar o catálogo depois não reescreve
 * o que já foi entregue a um paciente.
 *
 * Estes textos são material de APOIO, com linguagem para o paciente ler
 * sozinho. Nenhum deles substitui a conduta da profissional — quem decide o que
 * vai para cada pessoa é ela.
 */

export interface ReadyMadeCareNote {
  slug: string
  title: string
  /** Para agrupar na lista quando o catálogo crescer. */
  category: 'nutricao' | 'geral'
  /** Uma linha explicando quando usar. */
  hint: string
  body: string
}

/** Grupo do guia FODMAP, com os três níveis de tolerância. */
interface FodmapGroup {
  group: string
  baixo: string
  moderado: string
  alto: string
}

/**
 * Transcrito do guia prático em `nutri-doc/RS FODMAPs.xlsx`. Onde a planilha
 * trazia "X" (nível sem alimentos listados), a linha é omitida em vez de sair
 * um "X" solto no texto do paciente.
 */
const FODMAP: FodmapGroup[] = [
  {
    group: 'Frutas',
    baixo:
      'abacaxi, banana verde, carambola, framboesa, goiaba branca, kiwi, laranja, limão, mamão, mirtilo, morango, tangerina e uva',
    moderado: 'abacate, banana madura, coco seco, manga, maracujá, melão e romã',
    alto: 'ameixa, amora, caqui, cereja, damasco, figo, frutas secas, lichia, maçã, melancia, nectarina, pera e pêssego',
  },
  {
    group: 'Hortaliças e legumes',
    baixo:
      'abobrinha, acelga, alface, berinjela, brotos, cenoura, couve, espinafre, nabo, pepino, pimentão, rúcula, salsinha e vagem',
    moderado: 'abóbora, alho-poró, beterraba, cebolinha, brócolis, couve-flor e tomate',
    alto: 'alcachofra, alho, aspargos, cebola, cogumelo, milho, vagem torta, quiabo e repolho',
  },
  {
    group: 'Grãos, tubérculos e carboidratos',
    baixo:
      'arroz, aveia, batata inglesa, mandioca, macarrão de arroz, massas e pães sem glúten, quinoa e tapioca',
    moderado: 'batata-doce, inhame e pão de fermentação natural',
    alto: 'centeio, cevada, cuscuz, ervilha, feijão, grão-de-bico, lentilha, massas e pães comuns, soja e trigo',
  },
  {
    group: 'Gorduras e oleaginosas',
    baixo: 'azeite, amendoim, chia, macadâmia, nozes e semente de girassol',
    moderado: 'amêndoa, avelã e linhaça',
    alto: 'castanha de caju e pistache',
  },
  {
    group: 'Laticínios',
    baixo: 'leite sem lactose, manteiga e queijo curado',
    moderado: 'iogurte sem lactose, kefir, leite de cabra e ricota',
    alto: 'coalhada, leite condensado, leite comum (vaca, ovelha e soja) e sorvete',
  },
  {
    group: 'Líquidos',
    baixo: 'água, café e chá',
    moderado: 'café em excesso, refrigerante zero, suco de fruta (250 ml) e vinagre de maçã',
    alto: 'álcool, bebidas zero, cerveja, shoyu e sucos industrializados',
  },
  {
    group: 'Carnes',
    baixo: 'carne fresca (aves, boi, frango, frutos do mar, peixe e porco)',
    moderado: '',
    alto: 'carnes processadas e embutidos',
  },
  {
    group: 'Doces',
    baixo: '',
    moderado: 'açúcares em geral e doces caseiros',
    alto: 'adoçantes, mel e xaropes',
  },
]

function fodmapBody(): string {
  const linhas = FODMAP.map((g) => {
    const partes = [
      g.baixo ? `• Liberados: ${g.baixo}.` : null,
      g.moderado ? `• Com moderação: ${g.moderado}.` : null,
      g.alto ? `• Evitar por enquanto: ${g.alto}.` : null,
    ].filter(Boolean)
    return `${g.group.toUpperCase()}\n${partes.join('\n')}`
  })

  return [
    'GUIA PRÁTICO DE FODMAPs',
    '',
    'FODMAPs são tipos de carboidrato que fermentam no intestino e podem causar gases, inchaço e desconforto em quem tem sensibilidade. Este guia serve para a fase inicial, em que reduzimos os alimentos de alto teor para observar como o seu corpo responde.',
    '',
    'Importante: isto NÃO é uma dieta para a vida toda. Depois da fase de redução, os alimentos são reintroduzidos aos poucos, um grupo por vez, para descobrirmos exatamente quais incomodam você. Muita gente tolera bem a maioria deles.',
    '',
    ...linhas,
    '',
    'Como usar no dia a dia:',
    '• Porção importa: alimentos moderados costumam ser bem tolerados em quantidade pequena.',
    '• Anote o que comeu e como se sentiu. É isso que vai orientar a reintrodução.',
    '• Leia rótulos: alho e cebola aparecem como "tempero" e "aroma natural" em muitos industrializados.',
    '',
    'Qualquer dúvida ou sintoma novo, fale comigo antes de cortar mais alimentos por conta própria.',
  ].join('\n')
}

const HIDRATACAO = [
  'HIDRATAÇÃO NO DIA A DIA',
  '',
  'A água participa de praticamente tudo no corpo: transporta nutrientes, regula a temperatura e ajuda o intestino a funcionar. Beber pouco costuma aparecer como cansaço, dor de cabeça e intestino preso, sintomas que raramente associamos à sede.',
  '',
  'Como facilitar:',
  '• Deixe uma garrafa à vista, no lugar onde você passa mais tempo. O que está à vista é lembrado.',
  '• Beba um copo ao acordar e um antes de cada refeição.',
  '• Chá e água com rodela de fruta contam. Refrigerante e álcool não substituem.',
  '• Urina clara ao longo do dia é um bom sinal; urina escura pede mais água.',
  '',
  'Se você faz atividade física, aumente a quantidade nos dias de treino, e beba também durante, não só depois.',
].join('\n')

const ROTULOS = [
  'COMO LER UM RÓTULO DE ALIMENTO',
  '',
  'O rótulo responde três perguntas rápidas. Com elas você decide na prateleira, sem precisar decorar nada.',
  '',
  '1) O que é isto, de verdade?',
  'A lista de ingredientes vem em ordem de quantidade: o primeiro é o que mais tem no produto. Se açúcar, gordura ou farinha refinada aparecem nos três primeiros, o produto é basicamente isso.',
  '',
  '2) Quanto disso eu vou comer mesmo?',
  'A tabela é por 100 g e por porção. Confira o tamanho da porção, porque muitas embalagens declaram uma porção bem menor do que a que a gente come de fato.',
  '',
  '3) Tem alguma marca na frente?',
  'A lupa preta "ALTO EM" indica excesso de açúcar adicionado, gordura saturada ou sódio. Não é proibição: é informação para você escolher com que frequência consome.',
  '',
  'Atalhos úteis:',
  '• Quanto menor a lista de ingredientes, mais perto do alimento de verdade.',
  '• "Zero açúcar" não é o mesmo que "pouca caloria". Confira a gordura.',
  '• "Integral" precisa ter farinha integral entre os primeiros ingredientes, não só no nome.',
].join('\n')

const PRE_CONSULTA = [
  'COMO SE PREPARAR PARA A NOSSA CONSULTA',
  '',
  'Para aproveitarmos melhor o tempo juntos, se puder, traga:',
  '',
  '• Exames recentes, mesmo os que você acha que não têm a ver com alimentação.',
  '• A lista de medicamentos e suplementos que usa, com dose e horário.',
  '• Uma ideia do que costuma comer num dia comum, inclusive o fim de semana, que costuma ser bem diferente.',
  '• Suas dúvidas anotadas. É comum lembrar delas só depois que a consulta acaba.',
  '',
  'Sobre o dia da consulta:',
  '• Se formos fazer avaliação corporal, prefira roupa leve e evite exercício intenso nas horas anteriores.',
  '• Não precisa estar em jejum, a não ser que eu peça.',
  '',
  'Não tem resposta certa nem errada aqui. Quanto mais próximo da sua rotina real for o que você contar, melhor consigo montar um plano que caiba na sua vida.',
].join('\n')

export const READY_MADE_CARE_NOTES: readonly ReadyMadeCareNote[] = [
  {
    slug: 'fodmap-guia',
    title: 'Guia prático de FODMAPs',
    category: 'nutricao',
    hint: 'Fase de redução, com os alimentos separados por tolerância.',
    body: fodmapBody(),
  },
  {
    slug: 'hidratacao',
    title: 'Hidratação no dia a dia',
    category: 'nutricao',
    hint: 'Para quem bebe pouca água e não percebe.',
    body: HIDRATACAO,
  },
  {
    slug: 'leitura-rotulos',
    title: 'Como ler um rótulo de alimento',
    category: 'nutricao',
    hint: 'Três perguntas para decidir na prateleira.',
    body: ROTULOS,
  },
  {
    slug: 'preparo-consulta',
    title: 'Como se preparar para a consulta',
    category: 'geral',
    hint: 'Enviar antes do primeiro atendimento.',
    body: PRE_CONSULTA,
  },
]

export function readyMadeCareNote(slug: string): ReadyMadeCareNote | undefined {
  return READY_MADE_CARE_NOTES.find((n) => n.slug === slug)
}
