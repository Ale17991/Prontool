/**
 * Feature 017 — Cabeçalho de identidade da clínica no agendamento público.
 *
 * Vive fora da landing porque a landing deixou de ser a única porta de
 * entrada: clínica com um profissional só pula a escolha e cai direto nos
 * horários, e é ali que o paciente precisa reconhecer para onde está indo.
 */

import { CalendarCheck, MapPin, Phone } from 'lucide-react'

interface ClinicHeroProps {
  displayName: string
  addressLine: string | null
  phone: string | null
}

/** Iniciais da clínica para o avatar do hero (até 2 letras). */
function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase()
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase()
}

export function ClinicHero({ displayName, addressLine, phone }: ClinicHeroProps) {
  return (
    <header className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-[#003883] via-[#12559C] to-[#558CD3] px-6 py-8 text-white shadow-lg sm:px-8 sm:py-10">
      <div className="pointer-events-none absolute -right-10 -top-10 h-40 w-40 rounded-full bg-white/10" />
      <div className="pointer-events-none absolute -bottom-16 -left-8 h-44 w-44 rounded-full bg-white/5" />
      <div className="relative flex flex-col items-center gap-4 text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-white/20 text-2xl font-black backdrop-blur-sm ring-1 ring-white/30">
          {initials(displayName)}
        </div>
        <div className="space-y-1">
          <h1 className="text-2xl font-black tracking-tight sm:text-3xl">{displayName}</h1>
          <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-sm text-white/85">
            {addressLine && (
              <span className="inline-flex items-center gap-1.5">
                <MapPin className="h-3.5 w-3.5" />
                {addressLine}
              </span>
            )}
            {phone && (
              <span className="inline-flex items-center gap-1.5">
                <Phone className="h-3.5 w-3.5" />
                {phone}
              </span>
            )}
          </div>
        </div>
        <p className="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1 text-xs font-medium">
          <CalendarCheck className="h-3.5 w-3.5" />
          Agende sua consulta online em poucos cliques
        </p>
      </div>
    </header>
  )
}
