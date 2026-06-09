/**
 * Feature 029 — validação de XML TISS contra os XSDs oficiais 04.03.00.
 *
 * Usa `xmllint-wasm` (libxml2 em WebAssembly — sem binários nativos, seguro em
 * serverless). Carrega TODOS os `.xsd` de `schemas/<versão>/` na FS em memória do
 * xmllint para resolver os `include`/`import` (o schema raiz `tissV4_03_00.xsd`
 * inclui SimpleTypes/ComplexTypes/Guias e importa o xmldsig).
 *
 * Os XSDs da ANS são declarados em ISO-8859-1 → carregamos como bytes crus
 * (Buffer/Uint8Array), deixando o libxml honrar a declaração de encoding. O XML
 * a validar é UTF-8.
 *
 * Princípio IV (conformidade): este é o gate que garante que nenhum XML inválido
 * seja exportado. SC-001: 100% dos XMLs gerados devem validar aqui.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { validateXML, type XMLFileInfo } from 'xmllint-wasm'
import { TISS_VERSION } from './version'

/**
 * Padrão do schema raiz de mensagens: `tissV<maj>_<min>_<rev>.xsd`
 * (ex.: tissV4_03_00.xsd — a ANS NÃO usa zero à esquerda no major). Detectamos
 * por padrão em vez de construir o nome, para tolerar essa peculiaridade e
 * distinguir do `tissGuiasV…`, `tissSimpleTypesV…`, `tissComplexTypesV…`.
 */
const SCHEMA_ROOT_RE = /^tissV\d+_\d+_\d+\.xsd$/

function schemasDir(): string {
  // Override por env (deploy/bundling); senão resolve a partir do repo root.
  return (
    process.env.TISS_SCHEMAS_DIR ??
    join(process.cwd(), 'src', 'lib', 'core', 'tiss', 'schemas', TISS_VERSION)
  )
}

let cache: { root: XMLFileInfo; preload: XMLFileInfo[] } | null = null

function loadSchemas(): { root: XMLFileInfo; preload: XMLFileInfo[] } {
  if (cache) return cache
  const dir = schemasDir()
  const files = readdirSync(dir).filter((f) => f.endsWith('.xsd'))
  const rootFile = files.find((f) => SCHEMA_ROOT_RE.test(f))
  if (!rootFile) {
    throw new Error(
      `[tiss] schema raiz (tissV<maj>_<min>_<rev>.xsd) não encontrado em ${dir} — baixe os XSDs ${TISS_VERSION} (ver schemas/${TISS_VERSION}/SOURCE.md)`,
    )
  }
  const all: XMLFileInfo[] = files.map((fileName) => ({
    fileName,
    contents: readFileSync(join(dir, fileName)),
  }))
  const root = all.find((f) => f.fileName === rootFile)!
  // preload = todos os XSDs (inclui o raiz; xmllint resolve includes por fileName).
  cache = { root, preload: all }
  return cache
}

export interface TissValidationError {
  message: string
  line: number | null
}

export interface TissValidationResult {
  valid: boolean
  errors: TissValidationError[]
}

/**
 * Valida um documento XML (string UTF-8) contra o schema TISS 04.03.00.
 * Retorna `{ valid, errors }` com mensagens legíveis (sem nome de arquivo).
 */
export async function validateTissXml(xml: string): Promise<TissValidationResult> {
  const { root, preload } = loadSchemas()
  const result = await validateXML({
    xml: [{ fileName: 'mensagem.xml', contents: xml }],
    schema: [root],
    preload,
  })
  return {
    valid: result.valid,
    errors: result.errors.map((e) => ({
      message: e.message,
      line: e.loc?.lineNumber ?? null,
    })),
  }
}
