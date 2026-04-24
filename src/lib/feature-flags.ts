/**
 * Feature flags via env vars `NEXT_PUBLIC_FEATURE_*`. Default em
 * produção: false. Default em dev: true (forçando o desenvolvedor a
 * decidir explicitamente o que vai pra prod).
 *
 * Uso (server ou client):
 *   import { isFeatureEnabled } from '@/lib/feature-flags'
 *   if (isFeatureEnabled('despesas')) { ... }
 */
export type FeatureName = 'despesas' | 'anamnese' | 'relatorios' | 'comissoes'

const ENV_PREFIX = 'NEXT_PUBLIC_FEATURE_'

const FEATURE_MAP: Record<FeatureName, string> = {
  despesas: `${ENV_PREFIX}DESPESAS`,
  anamnese: `${ENV_PREFIX}ANAMNESE`,
  relatorios: `${ENV_PREFIX}RELATORIOS`,
  comissoes: `${ENV_PREFIX}COMISSOES`,
}

export function isFeatureEnabled(feature: FeatureName): boolean {
  const envName = FEATURE_MAP[feature]
  // process.env access is statically inlined by Next when prefixed with
  // NEXT_PUBLIC_, so this works on both server and client.
  const raw = process.env[envName]
  if (raw === undefined) {
    // No explicit flag → default true em dev/test, false em prod.
    return process.env.NODE_ENV !== 'production'
  }
  return raw === 'true' || raw === '1'
}

/** Map completo das features (útil no layout pra montar nav). */
export function listFeatureFlags(): Record<FeatureName, boolean> {
  return {
    despesas: isFeatureEnabled('despesas'),
    anamnese: isFeatureEnabled('anamnese'),
    relatorios: isFeatureEnabled('relatorios'),
    comissoes: isFeatureEnabled('comissoes'),
  }
}
