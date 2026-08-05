'use client'

import Link from 'next/link'
import { ChevronRight } from 'lucide-react'

interface DoctorOption {
  doctorId: string
  doctorFullName: string
  bio: string | null
}

interface DoctorListProps {
  slug: string
  doctors: DoctorOption[]
}

/** Iniciais do profissional (até 2 letras) para o avatar. */
function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase()
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase()
}

export function DoctorList({ slug, doctors }: DoctorListProps) {
  return (
    <ul className="space-y-3">
      {doctors.map((d) => (
        <li key={d.doctorId}>
          <Link
            href={`/agendar/${slug}/horarios?doctor_id=${d.doctorId}`}
            className="group flex items-center gap-4 rounded-xl border border-border bg-card p-4 transition hover:border-primary hover:shadow-md"
          >
            <span className="flex h-11 w-11 flex-none items-center justify-center rounded-full bg-gradient-to-br from-[#003883] to-[#558CD3] text-sm font-bold text-white">
              {initials(d.doctorFullName)}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block font-semibold text-foreground">{d.doctorFullName}</span>
              {d.bio && (
                <span className="mt-0.5 line-clamp-2 block text-sm text-muted-foreground">
                  {d.bio}
                </span>
              )}
              <span className="mt-1 inline-block text-xs font-medium text-primary">
                Agendar consulta
              </span>
            </span>
            <ChevronRight className="h-5 w-5 flex-none text-muted-foreground transition group-hover:translate-x-0.5 group-hover:text-primary" />
          </Link>
        </li>
      ))}
    </ul>
  )
}
