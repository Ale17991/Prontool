'use client'

import Link from 'next/link'

interface DoctorOption {
  doctorId: string
  doctorFullName: string
  bio: string | null
}

interface DoctorListProps {
  slug: string
  doctors: DoctorOption[]
}

export function DoctorList({ slug, doctors }: DoctorListProps) {
  return (
    <ul className="space-y-3">
      {doctors.map((d) => (
        <li key={d.doctorId}>
          <Link
            href={`/agendar/${slug}/horarios?doctor_id=${d.doctorId}`}
            className="block rounded-md border border-border bg-background p-4 transition hover:border-primary hover:shadow-sm"
          >
            <div className="font-semibold text-slate-900">{d.doctorFullName}</div>
            {d.bio && <p className="mt-1 text-sm text-slate-600">{d.bio}</p>}
            <div className="mt-2 text-xs font-medium text-primary">Agendar →</div>
          </Link>
        </li>
      ))}
    </ul>
  )
}
