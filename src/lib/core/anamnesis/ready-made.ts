import type { AnamnesisField } from './create-template'

/**
 * Modelos de anamnese prontos, para a clínica instalar em um clique.
 *
 * Por que catálogo em código e não tabela: um modelo pronto é conteúdo
 * editorial nosso, igual ao catálogo de exames da 050 — não é dado de clínica
 * nenhuma. Em TS ele fica versionado no git e revisável em PR, e a instalação
 * gera uma linha NORMAL em `anamnesis_templates`, do tenant, que a nutricionista
 * edita à vontade depois (editar cria versão nova, como qualquer modelo).
 *
 * Consequência importante: instalar é uma CÓPIA, não um vínculo. Melhorar o
 * catálogo aqui não mexe em quem já instalou — e é assim que tem que ser, senão
 * uma anamnese respondida mudaria de forma debaixo do prontuário.
 */

export interface ReadyMadeTemplate {
  slug: string
  title: string
  description: string
  /** Especialidade a que o modelo serve — para agrupar quando houver mais. */
  specialty: 'nutricao'
  fields: AnamnesisField[]
}

/**
 * Cabeçalho de seção. O motor de campos não tem tipo "seção", então a divisão
 * visual sai como um `texto_curto` não obrigatório com rótulo em caixa alta —
 * mesma convenção que o builder já produz quando a nutricionista digita um
 * título. Trocar isso exigiria mexer no schema de campos, que é append-only e
 * está em uso por anamneses já respondidas.
 */
function secao(id: string, titulo: string): AnamnesisField {
  // Seção se identifica pelo PREFIXO DO ID (`sec_`), não pelo rótulo: marcar
  // com travessões no texto obrigava quem lê a decorar uma convenção
  // tipográfica, e quebrava se alguém renomeasse o título.
  return { id, type: 'texto_curto', label: titulo.toUpperCase(), required: false }
}

const t = (id: string, label: string, required = false): AnamnesisField => ({
  id,
  type: 'texto_curto',
  label,
  required,
})
const longo = (id: string, label: string): AnamnesisField => ({
  id,
  type: 'texto_longo',
  label,
  required: false,
})
const escolha = (id: string, label: string, options: string[]): AnamnesisField => ({
  id,
  type: 'radio',
  label,
  required: false,
  options,
})
const lista = (id: string, label: string, options: string[]): AnamnesisField => ({
  id,
  type: 'select',
  label,
  required: false,
  options,
})
const num = (id: string, label: string): AnamnesisField => ({
  id,
  type: 'numero',
  label,
  required: false,
})

/**
 * Anamnese Alimentar — transcrita da aba "BD ANAMNESE" da planilha de trabalho
 * da nutricionista (`nutri-doc/AF..xlsm`), preservando as seções, a ordem e as
 * listas de opções originais.
 *
 * Dados de cadastro (nome, CPF, e-mail, telefone, endereço, CEP, nascimento)
 * ficam DE FORA de propósito: o motor já pré-preenche esses campos a partir do
 * cadastro do paciente via `is_default`, e repeti-los aqui faria a profissional
 * digitar de novo o que o sistema já sabe.
 */
const ANAMNESE_ALIMENTAR: ReadyMadeTemplate = {
  slug: 'anamnese-alimentar',
  title: 'Anamnese Alimentar',
  description:
    'Anamnese completa de nutrição: hábitos de vida, patologias, avaliação clínica, alimentação, atividade física e saúde da mulher. Baseada no roteiro de consulta da nutricionista.',
  specialty: 'nutricao',
  fields: [
    secao('sec_motivo', 'Motivo da consulta'),
    lista('motivo', 'Motivo principal', [
      'Perda de peso',
      'Ganho de peso',
      'Ganho muscular',
      'Definição muscular',
      'Manutenção de peso',
      'Tratamento de doenças',
      'Gestante',
      'Reeducação alimentar',
      'Rendimento físico',
      'Outro',
    ]),
    longo('motivo_detalhe', 'Qual o motivo de ter procurado um nutricionista?'),

    secao('sec_social', 'Dados sociais'),
    lista('estado_civil', 'Estado civil', [
      'Solteiro(a)',
      'Casado(a)',
      'Separado(a)',
      'Divorciado(a)',
      'Viúvo(a)',
    ]),
    t('ocupacao', 'Ocupação'),
    t('escolaridade', 'Escolaridade'),
    t('naturalidade', 'Naturalidade'),

    secao('sec_habitos', 'Hábitos de vida'),
    escolha('bons_habitos', 'Já possui bons hábitos alimentares?', ['Sim', 'Em parte', 'Não']),
    escolha('expectativa_prazo', 'Espera resultado rápido ou a longo prazo?', [
      'Rápido',
      'Longo prazo',
      'Não sabe',
    ]),
    escolha('tem_balanca', 'Possui balança de pesar alimentos?', ['Sim', 'Não']),
    escolha('sabe_fit_vs_dieta', 'Sabe a diferença entre refeição "fit" e fazer dieta?', [
      'Sim',
      'Não',
    ]),
    longo('sono', 'Como é o seu sono? (horas, qualidade, horário de dormir)'),
    longo('restricoes_rotina', 'Restrições de rotina (horários, viagens, trabalho)'),
    longo('alcool_fumo', 'Bebida alcoólica e fumo (frequência e quantidade)'),

    secao('sec_patologias', 'Patologias'),
    longo('sintomas_gerais', 'Sintomas gerais'),
    longo('outros_sintomas', 'Outros sintomas'),
    longo('cirurgias', 'Cirurgias (se sim, quais e quando)'),
    longo('patologias', 'Patologias diagnosticadas'),
    longo('medicamentos', 'Medicamentos em uso (nome, dose e horário)'),
    longo('historico_familiar', 'Histórico familiar'),

    secao('sec_clinica', 'Avaliação clínica'),
    longo('fisico_almejado', 'Existe um físico que almeja? (referência, físico antigo)'),
    longo('dificuldade_dieta', 'Dificuldade de seguir uma dieta regrada. Qual?'),
    escolha('habito_intestinal', 'Hábito intestinal', [
      'Diário',
      'A cada 2 dias',
      'A cada 3 dias ou mais',
      'Irregular',
      'Diarreia frequente',
    ]),
    t('cor_fezes', 'Cor das fezes'),
    lista('formato_fezes', 'Formato das fezes (escala de Bristol)', [
      'Tipo 1: bolinhas duras',
      'Tipo 2: grumosa',
      'Tipo 3: rachaduras na superfície',
      'Tipo 4: lisa e macia',
      'Tipo 5: pedaços macios',
      'Tipo 6: pastosa',
      'Tipo 7: líquida',
    ]),
    num('ingestao_hidrica_litros', 'Ingestão hídrica (litros por dia)'),
    escolha('hidratacao_urinaria', 'Coloração da urina', [
      'Clara',
      'Amarelo-clara',
      'Amarelo-escura',
      'Muito escura',
    ]),

    secao('sec_alimentacao', 'Alimentação'),
    longo('intolerancia_alergia', 'Intolerância ou alergia alimentar'),
    longo('preferencia_alimentar', 'Preferência alimentar'),
    longo('aversao_alimentar', 'Aversão alimentar'),
    escolha('belisca', 'Tem o costume de beliscar entre as refeições?', ['Sim', 'Às vezes', 'Não']),
    t('horario_mais_fome', 'Em que horário do dia sente mais fome?'),
    escolha('paladar', 'Paladar mais voltado a', [
      'Doces',
      'Salgados',
      'Amargos',
      'Sem preferência',
    ]),
    longo('dieta_especial', 'Segue alguma dieta especial? Qual?'),
    longo('refeicoes_locais', 'Quantas refeições por dia e em que locais?'),
    longo('suplementos', 'Faz uso de suplementos? Quais, dose e horário'),

    secao('sec_atividade', 'Atividade física'),
    longo('atividades_praticadas', 'Atividades físicas praticadas'),
    escolha('intensidade', 'Intensidade das atividades', ['Leve', 'Moderada', 'Intensa']),
    t('horario_atividade', 'Em qual horário pratica as atividades'),
    num('duracao_minutos', 'Duração de cada atividade (minutos)'),
    num('frequencia_semanal', 'Frequência por semana (dias)'),
    longo('sintomas_durante', 'Sintomas durante as atividades'),
    longo('sintomas_apos', 'Sintomas após as atividades'),
    longo('hidratacao_treino', 'Hidratação durante as atividades'),
    longo('alimentacao_antes', 'Alimentação / suplementação antes'),
    longo('alimentacao_durante', 'Alimentação / suplementação durante'),
    longo('alimentacao_apos', 'Alimentação / suplementação após'),

    // A planilha original chama esta seção de "Outros (Mulheres)". Mantivemos o
    // recorte clínico, mas o rótulo não pressupõe que a resposta dependa de como
    // a pessoa está cadastrada — quem não se aplica deixa em branco.
    secao('sec_saude_mulher', 'Saúde da mulher (quando se aplicar)'),
    { id: 'ultima_menstruacao', type: 'data', label: 'Última menstruação', required: false },
    longo('tpm', 'TPM (sintomas)'),
    t('ciclo_menstrual', 'Ciclo menstrual (regularidade e duração)'),
    t('contraceptivo', 'Contraceptivo em uso'),
    escolha('colicas', 'Cólicas', ['Ausentes', 'Leves', 'Moderadas', 'Intensas']),
    escolha('gestante', 'Gestante', ['Não', 'Sim']),
    escolha('lactante', 'Lactante', ['Não', 'Sim']),
    escolha('menopausa', 'Menopausa', ['Não', 'Sim']),

    secao('sec_observacoes', 'Observações'),
    longo('observacoes_gerais', 'Observações gerais'),
  ],
}

export const READY_MADE_TEMPLATES: readonly ReadyMadeTemplate[] = [ANAMNESE_ALIMENTAR]

export function readyMadeTemplate(slug: string): ReadyMadeTemplate | undefined {
  return READY_MADE_TEMPLATES.find((m) => m.slug === slug)
}
