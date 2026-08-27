// @ts-nocheck
/**
 * Completa cadastros ANTIGOS da conta "Thiago Padilha" com o que a planilha do
 * HiDoctor tem e o cadastro não tem (one-off, irmão do `importar-lista-padilha`).
 *
 * A importação PULOU 946 linhas por o paciente já existir. Só que muitos desses
 * cadastros antigos estão incompletos — 752 não têm telefone nenhum — e a
 * planilha tem o dado. Pular era certo na hora de inserir; deixar assim seria
 * jogar fora informação que já estava na mão.
 *
 * REGRA ÚNICA E INEGOCIÁVEL: só escreve em campo que está NULL. Nunca
 * sobrescreve. O que a clínica digitou vale mais que a planilha exportada —
 * ela pode ter corrigido um telefone que a planilha ainda traz errado, e um
 * "completar" que apaga correção é pior que não rodar.
 *
 * Rodar:
 *   pnpm tsx --env-file=.env.production.local scripts/completar-cadastros-padilha.ts
 *   ...                                                                  --executar
 */
import ExcelJS from 'exceljs'
import path from 'node:path'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import { fromTypedInput, isSendablePhone } from '@/lib/core/whatsapp/phone'

const TENANT = 'c1485d54-85a0-4a3d-9d95-8d36c008d7d3'
const ARQUIVO = 'docs/lista.xls'
const PRIMEIRA_LINHA = 7
const DDD_PADRAO = '24'
const CONCORRENCIA = 16

const EXECUTAR = process.argv.includes('--executar')
const sb: any = createSupabaseServiceClient()

const semAcento = (s) => (s ?? '').toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
const chaveNome = (s) =>
  semAcento(s)
    .replace(/[^A-Z0-9 ]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
const limpo = (s) => (s ?? '').replace(/\s+/g, ' ').trim()

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

/** Idêntica à do importador — mesma planilha, mesmas armadilhas. */
function extrairTelefones(bruto) {
  if (!bruto) return []
  let s = semAcento(bruto).replace(/[A-Z]+/g, ' ')
  s = s.replace(/[/;,]/g, ' ')
  s = s.replace(/[()\-.+]/g, '')
  const brutos = s.split(/\s+/).filter((t) => /^\d+$/.test(t))
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
  const cel = []
  const fix = []
  for (const t of tokens) {
    let d = t
    if (d.startsWith('55') && (d.length === 12 || d.length === 13)) d = d.slice(2)
    if (d.length === 12 && d.startsWith('0')) d = d.slice(1)
    if (d.length === 11 && d.startsWith('0')) d = d.slice(1)
    if (d.length === 8 || d.length === 9) d = DDD_PADRAO + d
    if (d.length !== 10 && d.length !== 11) continue
    const c = fromTypedInput(d)
    if (!isSendablePhone(c) || vistos.has(c)) continue
    vistos.add(c)
    ;(c.length === 13 ? cel : fix).push(c)
  }
  return [...cel, ...fix]
}

const ESTADO_CIVIL = {
  'SOLTEIRO(A)': 'solteiro',
  'CASADO(A)': 'casado',
  'DIVORCIADO(A)': 'divorciado',
  'VIUVO(A)': 'viuvo',
  'SEPARADO(A)': 'separado',
  'UNIAO ESTAVEL': 'uniao_estavel',
}
/** MORENA -> parda é decisão do Thiago (26/08/2026); ver o importador. */
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
const SEXO = { FEMININO: 'feminino', MASCULINO: 'masculino' }

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

/** Executa `tarefas` com no máximo `n` em voo — encriptar é uma ida ao banco. */
async function comLimite(tarefas, n) {
  const saida = []
  let i = 0
  await Promise.all(
    Array.from({ length: Math.min(n, tarefas.length) }, async () => {
      while (i < tarefas.length) {
        const meu = i++
        saida[meu] = await tarefas[meu]()
      }
    }),
  )
  return saida
}

// Campo do cadastro -> como tirar o valor da linha da planilha.
// `enc: true` = coluna cifrada (precisa da RPC); senão vai em claro.
const CAMPOS = [
  { col: 'phone_enc', enc: true, de: (l) => extrairTelefones(l.telefones)[0] ?? null },
  {
    col: 'birth_date_enc',
    enc: true,
    de: (l) => (/^\d{4}-\d{2}-\d{2}$/.test(l.nascimento) ? l.nascimento : null),
  },
  { col: 'email_enc', enc: true, de: (l) => (l.email && l.email.includes('@') ? l.email : null) },
  { col: 'insurance_card_number_enc', enc: true, de: (l) => l.matricula || null },
  { col: 'address_cep_enc', enc: true, de: (l) => l.cep || null },
  { col: 'address_street_enc', enc: true, de: (l) => separarLogradouro(l.logradouro).rua },
  { col: 'address_number_enc', enc: true, de: (l) => separarLogradouro(l.logradouro).numero },
  { col: 'address_complement_enc', enc: true, de: (l) => l.complemento || null },
  { col: 'address_neighborhood_enc', enc: true, de: (l) => l.bairro || null },
  { col: 'address_city_enc', enc: true, de: (l) => l.cidade || null },
  { col: 'address_state_enc', enc: true, de: (l) => l.uf || null },
  { col: 'sex', enc: false, de: (l) => SEXO[semAcento(l.sexo)] ?? null },
  {
    col: 'marital_status',
    enc: false,
    de: (l) => ESTADO_CIVIL[limpo(semAcento(l.estadoCivil))] ?? null,
  },
  { col: 'race', enc: false, de: (l) => COR[limpo(semAcento(l.cor))] ?? null },
  {
    col: 'occupation',
    enc: false,
    de: (l) => {
      const s = limpo(l.profissao).toUpperCase()
      return s ? s.slice(0, 120) : null
    },
  },
]

const COL = {
  nome: 1,
  sexo: 2,
  estadoCivil: 3,
  cor: 4,
  profissao: 5,
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

async function main() {
  const key = process.env.PATIENT_DATA_ENCRYPTION_KEY
  if (!key) throw new Error('PATIENT_DATA_ENCRYPTION_KEY ausente')

  // ---- 1. Planilha, indexada por nome ----
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.readFile(ARQUIVO)
  const ws = wb.worksheets[0]
  const porNome = new Map()
  const ambiguosNaPlanilha = new Set()
  for (let r = PRIMEIRA_LINHA; r <= ws.rowCount; r++) {
    const row = ws.getRow(r)
    const l = {}
    for (const [k, c] of Object.entries(COL)) l[k] = limpo(texto(row.getCell(c)))
    if (!l.nome) continue
    const k = chaveNome(l.nome)
    // Nome repetido na planilha com dados diferentes: não dá para saber qual é
    // o desta pessoa. Fica de fora — chutar aqui grava telefone de outro.
    if (porNome.has(k)) ambiguosNaPlanilha.add(k)
    else porNome.set(k, l)
  }
  console.log(`planilha: ${porNome.size} nomes (${ambiguosNaPlanilha.size} repetidos, ignorados)`)

  // ---- 2. Todos os pacientes da conta ----
  const colunas = ['id', 'anonymized_at', ...CAMPOS.map((c) => c.col)].join(', ')
  const pacientes = []
  for (let from = 0; ; from += 1000) {
    const r = await sb
      .from('patients')
      .select(colunas)
      .eq('tenant_id', TENANT)
      .range(from, from + 999)
    if (r.error) throw new Error(`patients: ${r.error.message}`)
    pacientes.push(...r.data)
    if (r.data.length < 1000) break
  }
  console.log(`pacientes na conta: ${pacientes.length}`)

  // ---- 3. Nomes ----
  const nome = new Map()
  const ids = pacientes.map((p) => p.id)
  for (let i = 0; i < ids.length; i += 200) {
    const dec = await sb.rpc('decrypt_patient_names_for_ids', {
      p_tenant_id: TENANT,
      p_patient_ids: ids.slice(i, i + 200),
      p_key: key,
    })
    if (dec.error) throw new Error(`decrypt: ${dec.error.message}`)
    for (const d of dec.data ?? []) nome.set(d.id, d.full_name)
  }

  // Nome repetido DENTRO da conta: idem, não dá para saber qual é qual.
  const quantos = new Map()
  for (const p of pacientes) {
    const k = chaveNome(nome.get(p.id) ?? '')
    quantos.set(k, (quantos.get(k) ?? 0) + 1)
  }

  // ---- 4. O que falta em cada um ----
  const planos = []
  const porCampo = new Map()
  let semMatch = 0
  let ambiguos = 0
  let anonimizados = 0

  for (const p of pacientes) {
    if (p.anonymized_at) {
      anonimizados++
      continue // quem exerceu o direito de sumir não é recompletado
    }
    const k = chaveNome(nome.get(p.id) ?? '')
    if (!k || quantos.get(k) > 1 || ambiguosNaPlanilha.has(k)) {
      ambiguos++
      continue
    }
    const l = porNome.get(k)
    if (!l) {
      semMatch++
      continue
    }
    const faltando = []
    for (const campo of CAMPOS) {
      if (p[campo.col] !== null && p[campo.col] !== undefined) continue // JÁ TEM: não encosta
      const valor = campo.de(l)
      if (valor === null || valor === '') continue
      faltando.push({ ...campo, valor })
      porCampo.set(campo.col, (porCampo.get(campo.col) ?? 0) + 1)
    }
    if (faltando.length) planos.push({ id: p.id, nome: nome.get(p.id), faltando })
  }

  console.log(`\nsem correspondência na planilha: ${semMatch}`)
  console.log(`homônimos (pulados por segurança): ${ambiguos}`)
  console.log(`anonimizados (nunca tocados): ${anonimizados}`)
  console.log(`\n>>> cadastros a completar: ${planos.length}`)
  console.log(`>>> campos a preencher: ${planos.reduce((a, p) => a + p.faltando.length, 0)}`)
  console.log('\npor campo:')
  for (const [c, n] of [...porCampo.entries()].sort((a, b) => b[1] - a[1]))
    console.log(`  ${String(n).padStart(5)}  ${c}`)

  console.log('\namostra:')
  for (const p of planos.slice(0, 8))
    console.log(`  ${p.nome} -> ${p.faltando.map((f) => `${f.col}=${f.valor}`).join(', ')}`)

  if (!EXECUTAR) {
    console.log('\n*** SIMULAÇÃO — nada foi gravado. Rode com --executar. ***')
    return
  }

  // ---- 5. Gravação ----
  console.log(`\ncompletando ${planos.length} cadastros...`)
  let feitos = 0
  const pulados = []
  const t0 = Date.now()
  for (let i = 0; i < planos.length; i += 50) {
    const bloco = planos.slice(i, i + 50)
    // Cifra tudo do bloco em paralelo (limitado), depois grava.
    const tarefas = []
    for (const p of bloco)
      for (const f of p.faltando)
        if (f.enc)
          tarefas.push(async () => {
            const r = await sb.rpc('enc_text_with_key', { plain: f.valor, key })
            if (r.error) throw new Error(`enc: ${r.error.message}`)
            return r.data
          })
        else tarefas.push(async () => f.valor)
    const cifrados = await comLimite(tarefas, CONCORRENCIA)

    let t = 0
    for (const p of bloco) {
      const patch = {}
      for (const f of p.faltando) patch[f.col] = cifrados[t++]
      // Rede de segurança REAL: a leitura que decidiu "está vazio" aconteceu
      // minutos atrás, e a clínica está usando o sistema agora. Exigir que TODA
      // coluna do patch ainda esteja NULL faz o banco recusar a linha inteira
      // se alguém preencheu qualquer uma delas nesse meio-tempo — em vez de eu
      // sobrescrever o que a recepção acabou de digitar.
      let q = sb.from('patients').update(patch).eq('tenant_id', TENANT).eq('id', p.id)
      for (const col of Object.keys(patch)) q = q.is(col, null)
      const up = await q.select('id')
      if (up.error) throw new Error(`update ${p.nome}: ${up.error.message}`)
      if (!up.data || up.data.length === 0) {
        pulados.push(p.nome)
        continue
      }
      feitos++
    }
    console.log(`  ${feitos}/${planos.length}  (${((Date.now() - t0) / 1000).toFixed(0)}s)`)
  }
  console.log(`\n✅ ${feitos} cadastros completados em ${((Date.now() - t0) / 1000).toFixed(0)}s.`)
}

main().catch((e) => {
  console.error('FATAL', e.message)
  process.exit(1)
})
