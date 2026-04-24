import type { IntegrationAdapter, ProviderId } from './types'

const registryMap: Partial<Record<ProviderId, IntegrationAdapter<any, any>>> = {}

export function registerAdapter<C, K>(adapter: IntegrationAdapter<C, K>): void {
  registryMap[adapter.provider] = adapter
}

export function getAdapter(provider: string): IntegrationAdapter<any, any> | null {
  return registryMap[provider as ProviderId] ?? null
}

export function listProviders(): ProviderId[] {
  return Object.keys(registryMap) as ProviderId[]
}

export function listAdapters(): IntegrationAdapter<any, any>[] {
  return Object.values(registryMap).filter(
    (a): a is IntegrationAdapter<any, any> => a !== undefined,
  )
}
