import { readFileSync } from 'node:fs'
import { parse as parseYaml } from 'yaml'

export interface OpenApiSpec {
  paths: Record<string, Record<string, unknown>>
  components?: { schemas?: Record<string, unknown> }
}

export function loadContract(path: string): OpenApiSpec {
  const raw = readFileSync(path, 'utf8')
  return parseYaml(raw) as OpenApiSpec
}

/**
 * Lightweight assertions against an OpenAPI doc. Full schema validation
 * is deferred to a dedicated validator library if the app ever hits the
 * limits of these shallow checks.
 */
export function assertPathExists(spec: OpenApiSpec, path: string, method: string): void {
  const p = spec.paths[path]
  if (!p) throw new Error(`contract: path ${path} missing`)
  if (!(method.toLowerCase() in p))
    throw new Error(`contract: ${method.toUpperCase()} ${path} missing`)
}

export function assertResponseCodes(
  spec: OpenApiSpec,
  path: string,
  method: string,
  codes: string[],
): void {
  const op = (spec.paths[path] as Record<string, { responses?: Record<string, unknown> }>)[
    method.toLowerCase()
  ]
  const responses = op?.responses ?? {}
  for (const code of codes) {
    if (!(code in responses)) {
      throw new Error(`contract: ${method.toUpperCase()} ${path} missing response ${code}`)
    }
  }
}
