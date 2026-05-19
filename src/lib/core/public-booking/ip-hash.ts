/**
 * Feature 017 — Hash de IP para anti-abuso (LGPD).
 *
 * NUNCA armazenamos IP em texto claro. Hash = SHA-256(ip + ':' + slug).
 * O slug entra para evitar reuso do mesmo hash entre tenants (defesa em
 * profundidade) e para que o hash não vire identificador estável global.
 */

import { createHash } from 'node:crypto'

export function hashIpForTenant(ip: string, slug: string): string {
  return createHash('sha256').update(`${ip}:${slug}`).digest('hex')
}
