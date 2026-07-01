/* eslint-disable react/no-unknown-property */
import { Image, StyleSheet, Text, View } from '@react-pdf/renderer'
import type { ClinicProfile } from '@/lib/core/clinic-profile/types'
import { formatCnpj } from '@/lib/core/clinic-profile/validate-cnpj'

/**
 * Cabeçalho compartilhado por todos os PDFs da feature 009.
 *
 * - Quando há logo + dados, renderiza logo (à esquerda) + bloco de
 *   identificação (à direita): razão social, CNPJ, endereço resumido,
 *   responsável técnico.
 * - Quando o profile está vazio (clínica não configurada), imprime aviso
 *   "Configure os dados da clínica em Configurações > Clínica" para
 *   atender FR-011 sem quebrar a geração do documento.
 *
 * O `subtitle` opcional aparece logo abaixo do bloco principal — usado
 * por documentos para descrever o tipo (ex.: "Prontuário eletrônico ·
 * Período X – Y").
 */

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    marginBottom: 12,
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#e2e8f0',
  },
  logoBox: {
    width: 56,
    height: 56,
    borderWidth: 0.5,
    borderColor: '#e2e8f0',
    borderRadius: 3,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  logoImage: {
    width: 56,
    height: 56,
    objectFit: 'contain',
  },
  logoPlaceholder: {
    fontSize: 6,
    color: '#94a3b8',
    textAlign: 'center',
    paddingHorizontal: 4,
  },
  body: { flex: 1, gap: 1 },
  clinicName: { fontSize: 14, fontFamily: 'Helvetica-Bold', color: '#0f172a' },
  legalName: { fontSize: 9, color: '#334155' },
  detail: { fontSize: 8, color: '#475569' },
  subtitle: { fontSize: 8, color: '#64748b', marginTop: 2 },
  warning: {
    backgroundColor: '#fef3c7',
    color: '#92400e',
    padding: 6,
    borderRadius: 3,
    fontSize: 8,
    fontFamily: 'Helvetica-Bold',
    marginBottom: 12,
  },
})

export interface ClinicHeaderProps {
  profile: ClinicProfile | null
  signedLogoUrl?: string | null
  /** Texto descritivo do documento (ex.: "Prontuário eletrônico"). */
  subtitle?: string
}

function formatSummaryAddress(p: ClinicProfile): string | null {
  const a = p.address
  const parts: string[] = []
  if (a.street) parts.push(a.number ? `${a.street}, ${a.number}` : a.street)
  if (a.complement) parts.push(a.complement)
  if (a.neighborhood) parts.push(a.neighborhood)
  if (a.city && a.uf) parts.push(`${a.city}/${a.uf}`)
  else if (a.city) parts.push(a.city)
  else if (a.uf) parts.push(a.uf)
  if (a.cep) parts.push(`CEP ${a.cep.replace(/^(\d{5})(\d{3})$/, '$1-$2')}`)
  const joined = parts.join(' · ')
  return joined.length > 0 ? joined : null
}

function formatTechResponsible(p: ClinicProfile): string | null {
  const t = p.techResponsible
  if (!t.name && !t.council && !t.registration) return null
  const head = t.name ?? '—'
  const tail = [t.council, t.registration].filter(Boolean).join(' ')
  return tail ? `${head} · ${tail}` : head
}

function formatContact(p: ClinicProfile): string | null {
  const items = [p.phone, p.email].filter(Boolean) as string[]
  return items.length > 0 ? items.join(' · ') : null
}

function isProfileEmpty(p: ClinicProfile | null): boolean {
  if (!p) return true
  return !(
    p.displayName ||
    p.corporateName ||
    p.cnpj ||
    p.phone ||
    p.email ||
    p.address.cep ||
    p.address.street ||
    p.techResponsible.name
  )
}

export function ClinicHeader({ profile, signedLogoUrl, subtitle }: ClinicHeaderProps) {
  if (isProfileEmpty(profile)) {
    return (
      <Text style={styles.warning}>
        Configure os dados da clínica em Configurações &gt; Clínica para que apareçam aqui no
        cabeçalho dos documentos.
      </Text>
    )
  }

  // profile não-nulo aqui (isProfileEmpty cobre o null).
  const p = profile as ClinicProfile
  const summary = formatSummaryAddress(p)
  const tech = formatTechResponsible(p)
  const contact = formatContact(p)

  return (
    <View style={styles.wrap}>
      <View style={styles.logoBox}>
        {signedLogoUrl ? (
          // eslint-disable-next-line jsx-a11y/alt-text -- react-pdf's <Image> does not accept alt
          <Image src={signedLogoUrl} style={styles.logoImage} />
        ) : (
          <Text style={styles.logoPlaceholder}>{p.displayName ?? p.corporateName ?? 'Logo'}</Text>
        )}
      </View>

      <View style={styles.body}>
        {/* Feature 010 (R13) — title primary = tenants.name (display).
            Razão social vira linha secundária junto com CNPJ. */}
        <Text style={styles.clinicName}>{p.displayName ?? p.corporateName ?? 'Clínica'}</Text>
        {p.corporateName && p.corporateName !== p.displayName ? (
          <Text style={styles.legalName}>{p.corporateName}</Text>
        ) : null}
        {p.cnpj ? <Text style={styles.detail}>CNPJ {formatCnpj(p.cnpj)}</Text> : null}
        {summary ? <Text style={styles.detail}>{summary}</Text> : null}
        {contact ? <Text style={styles.detail}>{contact}</Text> : null}
        {tech ? <Text style={styles.detail}>Responsável técnico: {tech}</Text> : null}
        {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
      </View>
    </View>
  )
}
