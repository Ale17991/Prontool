/**
 * Domain types compartilhados entre read/update/upload e UI.
 */

export interface ClinicProfileLogo {
  path: string
  signedUrl: string | null
  uploadedAt: string
}

export interface ClinicProfileAddress {
  cep: string | null
  street: string | null
  number: string | null
  complement: string | null
  neighborhood: string | null
  city: string | null
  uf: string | null
}

export interface ClinicProfileTechResponsible {
  name: string | null
  council: string | null
  registration: string | null
}

export interface ClinicProfile {
  tenantId: string
  /** Feature 010 (US3 / R13) — `tenants.name`. Display name (sidebar, seletor). */
  displayName: string | null
  logo: ClinicProfileLogo | null
  corporateName: string | null
  cnpj: string | null
  phone: string | null
  email: string | null
  address: ClinicProfileAddress
  techResponsible: ClinicProfileTechResponsible
  /** Feature 017 — slug do portal público (`/agendar/<slug>`). null = desativado. */
  publicBookingSlug: string | null
  /** Feature 017 — portal habilitado de fato (gate da página pública). */
  publicBookingEnabled: boolean
  /** Período (minutos) que cada linha da agenda representa. Default 60. */
  calendarSlotIntervalMinutes: number
  /** Horário de funcionamento — abertura, 'HH:MM'. Default '07:00'. */
  calendarOpenTime: string
  /** Horário de funcionamento — fechamento (exclusivo), 'HH:MM'. Default '22:00'. */
  calendarCloseTime: string
  /** Backlog 1/4/3 — exige escanear material cirúrgico para finalizar. Default false. */
  surgicalScanRequired: boolean
  updatedAt: string
}

export const CLINIC_LOGO_BUCKET = 'clinic-logos' as const
export const CLINIC_LOGO_SIGNED_URL_TTL_SECONDS = 60 * 60 * 24 // 24 h
export const CLINIC_LOGO_PDF_SIGNED_URL_TTL_SECONDS = 60 * 5 // 5 min
export const MAX_LOGO_BYTES = 2 * 1024 * 1024 // 2 MB

export const COUNCIL_CODES = [
  'CRM',
  'CRO',
  'CREFITO',
  'CRP',
  'CRN',
  'COREN',
  'CRF',
  'CRBM',
  'CRESS',
  'CRMV',
  'CRO',
  'CREF',
  'CRA',
] as const

export const UF_CODES = [
  'AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA',
  'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN',
  'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO',
] as const
