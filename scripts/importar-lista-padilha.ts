// @ts-nocheck
/**
 * Carga da base do HiDoctor na conta "Thiago Padilha" (one-off).
 *
 * Fonte: `docs/lista.xls` — apesar da extensão, é um .xlsx (assinatura PK).
 * Cabeçalho na linha 6, dados a partir da 7.
 *
 * Rodar:
 *   pnpm tsx --env-file=.env.production.local scripts/importar-lista-padilha.ts
 *   ...                                       --convenios    (cria os 7 que faltam)
 *   ...                                       --executar     (grava de verdade)
 *
 * Sem `--executar` é SIMULAÇÃO: lê tudo, decide tudo, relata e não escreve nada.
 * Exige `import_patients_bulk` aplicada (deploy-import-pacientes-padilha.sql).
 */
import ExcelJS from 'exceljs'
import path from 'node:path'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import { fromTypedInput, isSendablePhone } from '@/lib/core/whatsapp/phone'

const TENANT = 'c1485d54-85a0-4a3d-9d95-8d36c008d7d3'
const ARQUIVO = 'docs/lista.xls'
const PRIMEIRA_LINHA = 7
const LOTE = 500

/**
 * O DDD que a planilha não traz. A base é da região Sul Fluminense (Volta
 * Redonda, Barra Mansa, Barra do Piraí, Angra, Resende) — 24 em todas. Decisão
 * do Thiago: número sem DDD é 24, sem exceção por cidade.
 */
const DDD_PADRAO = '24'

const EXECUTAR = process.argv.includes('--executar')
const CRIAR_CONVENIOS = process.argv.includes('--convenios')

/** `--limite=N` grava só os N primeiros. Serve para medir antes de soltar tudo. */
const LIMITE = Number(
  (process.argv.find((a) => a.startsWith('--limite=')) ?? '').split('=')[1] ?? '0',
)
/** `--lote=N` sobrescreve o tamanho do lote (o padrão é `LOTE`). */
const LOTE_ARG = Number(
  (process.argv.find((a) => a.startsWith('--lote=')) ?? '').split('=')[1] ?? '0',
)

const sb: any = createSupabaseServiceClient()

// ---------------------------------------------------------------------------
// Leitura da planilha
// ---------------------------------------------------------------------------

const COL = {
  nome: 1,
  sexo: 2,
  estadoCivil: 3, // -> patients.marital_status (0208)
  cor: 4, // -> patients.race (0208)
  profissao: 5, // -> patients.occupation (0208)
  convenio: 6,
  matricula: 7,
  nascimento: 8,
  logradouro: 9,
  complemento: 10,
  bairro: 11,
  cidade: 12,
  uf: 13,
  cep: 14,
  telefones: 15,
  email: 16,
}

function texto(c) {
  const v = c?.value
  if (v === null || v === undefined) return ''
  if (v instanceof Date) return v.toISOString().slice(0, 10)
  if (typeof v === 'object') {
    if (v.richText) return v.richText.map((r) => r.text).join('')
    if (v.text) return String(v.text)
    if (v.result !== undefined) return String(v.result)
    return ''
  }
  return String(v)
}

const semAcento = (s) => (s ?? '').toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
const chaveNome = (s) =>
  semAcento(s)
    .replace(/[^A-Z0-9 ]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
const limpo = (s) => (s ?? '').replace(/\s+/g, ' ').trim()

// ---------------------------------------------------------------------------
// Telefone — a parte que mais erra, e a que mais custa quando erra
// ---------------------------------------------------------------------------

/**
 * A célula de telefone do HiDoctor é campo livre. Aparecem, no mesmo lugar:
 * número sem DDD (`999756721`), com DDD (`24999272822`), com 0 na frente
 * (`021999892280`), com país (`+55 24 99995-3970`), dois números separados por
 * barra, dois números colados (`(24) 99816-1246 (24) 99816-1246`), número com
 * nome de recado (`999743903 ELISABETH`) e recado sem número nenhum
 * (`SEM FIXO`, `ESTA CM ALINE`).
 *
 * Devolve os números em ordem de preferência: celular antes de fixo. Só sai
 * daqui o que `isSendablePhone` aprova — o resto vira pendência com o texto
 * original, porque telefone que não alcança ninguém é pior que telefone
 * ausente: ele parece cadastro completo.
 */
function extrairTelefones(bruto) {
  if (!bruto) return []

  // 1) Letras viram separador: "24427140 ZILDA 24427470" são dois números, e o
  //    nome no meio é justamente a fronteira entre eles.
  let s = semAcento(bruto).replace(/[A-Z]+/g, ' ')
  // 2) Barra, ponto-e-vírgula e vírgula separam um número do outro.
  s = s.replace(/[/;,]/g, ' ')
  // 3) Hífen, parênteses, ponto e "+" são pontuação DENTRO de um número
  //    (`99234-0289`, `(24)98144-0094`) — somem sem deixar espaço. Trocá-los por
  //    espaço parte o assinante ao meio: `99234-0289` viraria "99234" + "0289",
  //    dois blocos curtos demais para virar telefone, e a linha inteira seria
  //    descartada por "sem telefone". Só o espaço separa números diferentes.
  s = s.replace(/[()\-.+]/g, '')

  const brutos = s.split(/\s+/).filter((t) => /^\d+$/.test(t))

  // 4) `(24) 99816-1246` chegou aqui como ["24", "998161246"]: um bloco de DDD
  //    solto seguido do assinante. Recolar é o que salva ~4,6 mil linhas.
  const tokens = []
  for (let i = 0; i < brutos.length; i++) {
    const t = brutos[i]
    const prox = brutos[i + 1]
    const ehDdd = (t.length === 2 || (t.length === 3 && t.startsWith('0'))) && t !== '55'
    if (ehDdd && prox && (prox.length === 8 || prox.length === 9)) {
      tokens.push(t.replace(/^0/, '') + prox)
      i++
      continue
    }
    if (t === '55' && prox && (prox.length === 10 || prox.length === 11)) {
      tokens.push(prox)
      i++
      continue
    }
    tokens.push(t)
  }

  const vistos = new Set()
  const celulares = []
  const fixos = []

  for (const t of tokens) {
    let d = t
    if (d.startsWith('55') && (d.length === 12 || d.length === 13)) d = d.slice(2)
    if (d.length === 12 && d.startsWith('0')) d = d.slice(1)
    if (d.length === 11 && d.startsWith('0')) d = d.slice(1)

    // Sem DDD: 9 dígitos é celular, 8 é fixo. Os dois ganham o 24.
    if (d.length === 8 || d.length === 9) d = DDD_PADRAO + d
    if (d.length !== 10 && d.length !== 11) continue // 7 dígitos, 22 dígitos, lixo

    const canonico = fromTypedInput(d)
    if (!isSendablePhone(canonico)) continue
    if (vistos.has(canonico)) continue
    vistos.add(canonico)

    // Depois do canônico: 55 + DDD + 9 dígitos = celular; + 8 = fixo.
    if (canonico.length === 13) celulares.push(canonico)
    else fixos.push(canonico)
  }

  return [...celulares, ...fixos]
}

// ---------------------------------------------------------------------------
// Convênio
// ---------------------------------------------------------------------------

/**
 * Regra do Thiago: a conta tem duas Unimeds. "Volta Redonda" é a própria; toda
 * outra Unimed — Barra Mansa, Central Nacional, Rio, Seguros, as de fora do
 * estado — é atendimento de intercâmbio.
 *
 * `null` = importa sem convênio (Particular está inativo na conta, e a decisão
 * foi não reativar). `alerta` = a célula não era convênio, era recado.
 */
function mapearConvenio(bruto) {
  const c = limpo(semAcento(bruto))
  if (!c) return { plano: null, alerta: null }
  if (c.includes('NAO REMARCAR')) return { plano: null, alerta: 'NÃO REMARCAR ESTE PACIENTE' }

  if (c.includes('UNIMED')) {
    if (c.includes('VOLTA REDONDA')) return { plano: 'Unimed - Volta Redonda', alerta: null }
    if (c.startsWith('SULAMERICA'))
      return { plano: 'Sulamerica Saude - Reciprocidade Unimed', alerta: null }
    return { plano: 'Unimed - Intercâmbio', alerta: null }
  }
  if (c.startsWith('SULAMERICA'))
    return { plano: 'Sulamerica Saude - Reciprocidade Unimed', alerta: null }
  if (c.startsWith('BRADESCO')) return { plano: 'Bradesco Saúde', alerta: null }
  if (c.startsWith('AMIL')) return { plano: 'Amil', alerta: null }
  if (c.startsWith('SAUDE CAIXA')) return { plano: 'Saúde Caixa', alerta: null }
  if (c.startsWith('PETROBRAS')) return { plano: 'Petrobras', alerta: null }
  if (c.startsWith('CASSI')) return { plano: 'Cassi', alerta: null }
  if (c.startsWith('MEDISERVICE')) return { plano: 'Mediservice', alerta: null }
  if (c.startsWith('PORTO SEGURO')) return { plano: 'Porto Seguro - Saúde Itaú', alerta: null }
  if (c.includes('FLAVIO LEAL')) return { plano: 'Hospital Flavio Leal - Pirai', alerta: null }
  // Particular / Cortesia: convênio inativo na conta, entra sem plano.
  if (c.startsWith('PARTICULAR') || c === 'CORTESIA') return { plano: null, alerta: null }

  if (c.startsWith('ASSOC.APOSENTADOS') || c.startsWith('ASSOC APOSENTADOS'))
    return { plano: 'Assoc. Aposentados', alerta: null }
  if (c.startsWith('SUS PIRAI')) return { plano: 'SUS Piraí', alerta: null }
  if (c.startsWith('GOLDEN CROSS')) return { plano: 'Golden Cross', alerta: null }
  if (c.startsWith('POSTAL SAUDE')) return { plano: 'Postal Saúde', alerta: null }
  if (c.startsWith('ABERTTA')) return { plano: 'Abertta Saúde', alerta: null }
  if (c === 'INB') return { plano: 'INB', alerta: null }
  if (c === 'OUTROS') return { plano: null, alerta: null }

  return { plano: null, alerta: null }
}

const CONVENIOS_A_CRIAR = [
  'Assoc. Aposentados',
  'SUS Piraí',
  'Golden Cross',
  'Postal Saúde',
  'Abertta Saúde',
  'INB',
]

// ---------------------------------------------------------------------------
// Endereço
// ---------------------------------------------------------------------------

/** "Rua Doutor Coutinho, 172" chega numa coluna só; o cadastro tem duas. */
function separarLogradouro(bruto) {
  const s = limpo(bruto)
  if (!s) return { rua: null, numero: null }
  const i = s.lastIndexOf(',')
  if (i < 0) return { rua: s, numero: null }
  const rua = limpo(s.slice(0, i))
  const numero = limpo(s.slice(i + 1))
  if (!numero || numero.length > 12) return { rua: s, numero: null }
  return { rua: rua || s, numero }
}

const SEXO = { FEMININO: 'feminino', MASCULINO: 'masculino' }

// ---------------------------------------------------------------------------
// Estado civil, raça/cor e ocupação (migration 0208)
// ---------------------------------------------------------------------------

const ESTADO_CIVIL = {
  'SOLTEIRO(A)': 'solteiro',
  'CASADO(A)': 'casado',
  'DIVORCIADO(A)': 'divorciado',
  'VIUVO(A)': 'viuvo',
  'SEPARADO(A)': 'separado',
  'UNIAO ESTAVEL': 'uniao_estavel',
}

/**
 * A planilha usa um vocabulário que não é o do IBGE/e-SUS. BRANCA, PARDA e
 * AMARELA são diretos; NEGRO/negra é a mesma coisa que "preta" no uso corrente.
 *
 * MORENA (527 pacientes) NÃO é categoria do IBGE e comporta mais de uma
 * leitura. A conversão para "parda" é DECISÃO DO THIAGO, tomada em 26/08/2026,
 * e está registrada aqui porque raça/cor é dado AUTODECLARADO: o que entra no
 * banco por esta linha é uma tradução nossa, não o que a pessoa disse. Vale
 * reperguntar na próxima consulta — o relatório abaixo conta quantos são.
 */
const COR = {
  BRANCA: 'branca',
  PARDA: 'parda',
  AMARELA: 'amarela',
  NEGRO: 'preta',
  NEGRA: 'preta',
  MORENA: 'parda',
  MORENO: 'parda',
  INDIGENA: 'indigena',
}

const OCUPACAO_MAX = 120

/**
 * A base traz "ESTUDANTE" (1.911) e "estudante" (210) como se fossem coisas
 * diferentes. Subir tudo para caixa alta funde os dois e acompanha o resto do
 * cadastro, que já está em caixa alta — sem isso, qualquer agrupamento por
 * ocupação contaria a mesma profissão duas vezes.
 */
function normalizarOcupacao(bruto) {
  const s = limpo(bruto).toUpperCase()
  if (!s) return null
  return s.length > OCUPACAO_MAX ? s.slice(0, OCUPACAO_MAX) : s
}

// ---------------------------------------------------------------------------

async function main() {
  const key = process.env.PATIENT_DATA_ENCRYPTION_KEY
  if (!key) throw new Error('PATIENT_DATA_ENCRYPTION_KEY ausente')

  // ---- 1. Planilha ----
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.readFile(ARQUIVO)
  const ws = wb.worksheets[0]

  const linhas = []
  for (let r = PRIMEIRA_LINHA; r <= ws.rowCount; r++) {
    const row = ws.getRow(r)
    const o = { __linha: r }
    for (const [k, c] of Object.entries(COL)) o[k] = limpo(texto(row.getCell(c)))
    if (!o.nome) continue
    linhas.push(o)
  }
  console.log(`planilha: ${linhas.length} linhas com nome`)

  // ---- 2. Convênios ----
  const planosRes = await sb.from('health_plans').select('id, name, active').eq('tenant_id', TENANT)
  if (planosRes.error) throw new Error(`health_plans: ${planosRes.error.message}`)
  const idPorPlano = new Map(planosRes.data.map((p) => [p.name, p.id]))

  const faltando = CONVENIOS_A_CRIAR.filter((n) => !idPorPlano.has(n))
  if (faltando.length) {
    if (CRIAR_CONVENIOS) {
      const ins = await sb
        .from('health_plans')
        .insert(faltando.map((name) => ({ tenant_id: TENANT, name, active: true })))
        .select('id, name')
      if (ins.error) throw new Error(`criar convênios: ${ins.error.message}`)
      for (const p of ins.data) idPorPlano.set(p.name, p.id)
      console.log(`convênios criados: ${ins.data.map((p) => p.name).join(', ')}`)
    } else {
      console.log(`convênios a criar (use --convenios): ${faltando.join(', ')}`)
    }
  }

  // ---- 3. Quem já está na base ----
  const ids = []
  for (let from = 0; ; from += 1000) {
    const r = await sb
      .from('patients')
      .select('id')
      .eq('tenant_id', TENANT)
      .range(from, from + 999)
    if (r.error) throw new Error(`patients: ${r.error.message}`)
    ids.push(...r.data.map((x) => x.id))
    if (r.data.length < 1000) break
  }
  const jaNaBase = new Set()
  for (let i = 0; i < ids.length; i += 200) {
    const dec = await sb.rpc('decrypt_patient_names_for_ids', {
      p_tenant_id: TENANT,
      p_patient_ids: ids.slice(i, i + 200),
      p_key: key,
    })
    if (dec.error) throw new Error(`decrypt: ${dec.error.message}`)
    for (const d of dec.data ?? []) if (d.full_name) jaNaBase.add(chaveNome(d.full_name))
  }
  console.log(`já cadastrados: ${ids.length} (${jaNaBase.size} nomes distintos)`)

  // ---- 4. Normalização ----
  const paraImportar = []
  const pendencias = []
  const vistosNoArquivo = new Set()
  const contagem = {
    duplicataBase: 0,
    duplicataArquivo: 0,
    semTelefone: 0,
    telefoneExtra: 0,
    corMorena: 0,
  }
  // Valor da planilha que nenhuma regra reconheceu. Sem esta contagem, uma
  // grafia nova entraria como null e ninguém saberia que houve perda.
  const naoMapeado = { estadoCivil: new Map(), cor: new Map() }

  for (const l of linhas) {
    const chave = chaveNome(l.nome)

    if (jaNaBase.has(chave)) {
      contagem.duplicataBase++
      continue
    }
    if (vistosNoArquivo.has(chave)) {
      contagem.duplicataArquivo++
      pendencias.push({ ...l, motivo: 'nome repetido dentro da própria planilha' })
      continue
    }

    const tels = extrairTelefones(l.telefones)
    if (tels.length === 0) {
      contagem.semTelefone++
      pendencias.push({ ...l, motivo: 'sem telefone aproveitável' })
      continue
    }
    if (tels.length > 1) contagem.telefoneExtra += tels.length - 1

    vistosNoArquivo.add(chave)

    const ec = limpo(semAcento(l.estadoCivil))
    const cr = limpo(semAcento(l.cor))
    if (ec && !ESTADO_CIVIL[ec])
      naoMapeado.estadoCivil.set(ec, (naoMapeado.estadoCivil.get(ec) ?? 0) + 1)
    if (cr && !COR[cr]) naoMapeado.cor.set(cr, (naoMapeado.cor.get(cr) ?? 0) + 1)
    if (cr === 'MORENA' || cr === 'MORENO') contagem.corMorena++

    const { plano, alerta } = mapearConvenio(l.convenio)
    const { rua, numero } = separarLogradouro(l.logradouro)
    const nascimento = /^\d{4}-\d{2}-\d{2}$/.test(l.nascimento) ? l.nascimento : null

    paraImportar.push({
      __linha: l.__linha,
      __telefonesExtras: tels.slice(1),
      full_name: l.nome,
      phone: tels[0],
      birth_date: nascimento,
      email: l.email && l.email.includes('@') ? l.email : null,
      sex: SEXO[semAcento(l.sexo)] ?? null,
      marital_status: ESTADO_CIVIL[limpo(semAcento(l.estadoCivil))] ?? null,
      race: COR[limpo(semAcento(l.cor))] ?? null,
      occupation: normalizarOcupacao(l.profissao),
      plan_id: plano ? (idPorPlano.get(plano) ?? null) : null,
      alert_note: alerta,
      insurance_card_number: l.matricula || null,
      address_cep: l.cep || null,
      address_street: rua,
      address_number: numero,
      address_complement: l.complemento || null,
      address_neighborhood: l.bairro || null,
      address_city: l.cidade || null,
      address_state: l.uf || null,
    })
  }

  // ---- 5. Relatório ----
  console.log('\n================ RESUMO ================')
  console.log(`linhas na planilha .............. ${linhas.length}`)
  console.log(`já existem na conta (por nome) .. ${contagem.duplicataBase}`)
  console.log(`repetidas dentro da planilha .... ${contagem.duplicataArquivo}`)
  console.log(`sem telefone aproveitável ....... ${contagem.semTelefone}`)
  console.log(`A IMPORTAR ...................... ${paraImportar.length}`)
  console.log(`telefones extras descartados .... ${contagem.telefoneExtra}`)

  const comPlano = paraImportar.filter((p) => p.plan_id).length
  console.log(`\ncom convênio .................... ${comPlano}`)
  console.log(`sem convênio .................... ${paraImportar.length - comPlano}`)
  console.log(
    `com data de nascimento .......... ${paraImportar.filter((p) => p.birth_date).length}`,
  )
  console.log(`com e-mail ...................... ${paraImportar.filter((p) => p.email).length}`)
  console.log(
    `com recado (alerta) ............. ${paraImportar.filter((p) => p.alert_note).length}`,
  )
  const cel = paraImportar.filter((p) => p.phone.length === 13).length
  console.log(`telefone celular ................ ${cel}`)
  console.log(`telefone fixo ................... ${paraImportar.length - cel}`)

  console.log(
    `\ncom estado civil ................ ${paraImportar.filter((p) => p.marital_status).length}`,
  )
  console.log(`com raça/cor .................... ${paraImportar.filter((p) => p.race).length}`)
  console.log(
    `com ocupação .................... ${paraImportar.filter((p) => p.occupation).length}`,
  )
  if (contagem.corMorena)
    console.log(
      `  ⚠ ${contagem.corMorena} vieram como "MORENA" e foram gravados como "parda" —\n` +
        '    raça/cor é autodeclarada, então vale reperguntar na próxima consulta.',
    )
  for (const [campo, mapa] of [
    ['estado civil', naoMapeado.estadoCivil],
    ['raça/cor', naoMapeado.cor],
  ]) {
    if (!mapa.size) continue
    console.log(`  ⚠ ${campo} não reconhecido (entrou vazio):`)
    for (const [k, v] of [...mapa.entries()].sort((a, b) => b[1] - a[1]))
      console.log(`      ${String(v).padStart(5)}  "${k}"`)
  }

  console.log('\namostra (5 primeiros):')
  for (const p of paraImportar.slice(0, 5))
    console.log(
      `  L${p.__linha} ${p.full_name} | ${p.phone} | ${p.birth_date ?? '—'} | ${p.sex ?? '—'} | plano=${p.plan_id ? 'sim' : '—'} | ${p.address_street ?? '—'}, ${p.address_number ?? 's/n'} - ${p.address_city ?? '—'}`,
    )

  // ---- 6. Planilha de pendências ----
  const out = new ExcelJS.Workbook()
  const wsP = out.addWorksheet('Não importados')
  wsP.columns = [
    { header: 'Linha', key: 'linha', width: 8 },
    { header: 'Motivo', key: 'motivo', width: 38 },
    { header: 'Nome', key: 'nome', width: 38 },
    { header: 'Telefone (original)', key: 'tel', width: 30 },
    { header: 'Convênio', key: 'conv', width: 26 },
    { header: 'Nascimento', key: 'nasc', width: 14 },
    { header: 'Cidade', key: 'cidade', width: 20 },
  ]
  wsP.getRow(1).font = { bold: true }
  for (const p of pendencias)
    wsP.addRow({
      linha: p.__linha,
      motivo: p.motivo,
      nome: p.nome,
      tel: p.telefones,
      conv: p.convenio,
      nasc: p.nascimento,
      cidade: p.cidade,
    })

  const wsE = out.addWorksheet('Telefones extras')
  wsE.columns = [
    { header: 'Nome', key: 'nome', width: 38 },
    { header: 'Telefone gravado', key: 'principal', width: 20 },
    { header: 'Outros da ficha', key: 'extras', width: 40 },
    { header: 'Original', key: 'orig', width: 30 },
  ]
  wsE.getRow(1).font = { bold: true }
  for (const p of paraImportar.filter((x) => x.__telefonesExtras.length))
    wsE.addRow({
      nome: p.full_name,
      principal: p.phone,
      extras: p.__telefonesExtras.join(' / '),
      orig: linhas.find((l) => l.__linha === p.__linha)?.telefones ?? '',
    })

  const caminho = path.join(process.cwd(), 'docs', 'padilha-import-pendencias.xlsx')
  await out.xlsx.writeFile(caminho)
  console.log(
    `\npendências -> ${caminho} (${pendencias.length} não importados, ${wsE.rowCount - 1} com telefone extra)`,
  )

  // ---- 7. Gravação ----
  if (!EXECUTAR) {
    console.log('\n*** SIMULAÇÃO — nada foi gravado. Rode com --executar. ***')
    return
  }

  const fila = LIMITE > 0 ? paraImportar.slice(0, LIMITE) : paraImportar
  const tamLote = LOTE_ARG > 0 ? LOTE_ARG : LOTE
  if (LIMITE > 0) console.log(`\n⚠ --limite=${LIMITE}: gravando só os ${fila.length} primeiros.`)
  console.log(`\ngravando ${fila.length} pacientes em lotes de ${tamLote}...`)

  // Interrupção no meio NÃO corrompe nada: `jaNaBase` é remontado do banco a
  // cada execução, então rodar de novo retoma de onde parou em vez de duplicar.
  let gravados = 0
  const t0 = Date.now()
  for (let i = 0; i < fila.length; i += tamLote) {
    const lote = fila.slice(i, i + tamLote).map(({ __linha, __telefonesExtras, ...r }) => r)
    const tLote = Date.now()
    const res = await sb.rpc('import_patients_bulk', {
      p_tenant_id: TENANT,
      p_key: key,
      p_rows: lote,
    })
    if (res.error) {
      console.error(`\n✖ lote ${Math.floor(i / tamLote) + 1} falhou: ${res.error.message}`)
      console.error(`  ${gravados} já gravados. Rode de novo — o script retoma de onde parou.`)
      throw new Error(res.error.message)
    }
    gravados += res.data ?? 0
    const seg = ((Date.now() - tLote) / 1000).toFixed(1)
    const total = ((Date.now() - t0) / 1000).toFixed(0)
    console.log(`  ${gravados}/${fila.length}  (lote ${seg}s, acumulado ${total}s)`)
  }
  console.log(`\n✅ ${gravados} pacientes importados em ${((Date.now() - t0) / 1000).toFixed(0)}s.`)
  console.log('Agora rode o DROP da função (fim de deploy-import-pacientes-padilha.sql).')
}

main().catch((e) => {
  console.error('FATAL', e.message)
  process.exit(1)
})
