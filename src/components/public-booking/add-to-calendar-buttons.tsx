'use client'

interface AddToCalendarButtonsProps {
  title: string
  description: string
  location: string
  startIso: string
  durationMinutes: number
  /** URL do .ics para download direto (Apple, Outlook). */
  icsDownloadUrl: string
}

function googleCalendarUrl(input: AddToCalendarButtonsProps): string {
  const start = new Date(input.startIso)
  const end = new Date(start.getTime() + input.durationMinutes * 60 * 1000)
  const fmt = (d: Date): string =>
    `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(
      d.getUTCDate(),
    ).padStart(2, '0')}T${String(d.getUTCHours()).padStart(2, '0')}${String(
      d.getUTCMinutes(),
    ).padStart(2, '0')}00Z`
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: input.title,
    dates: `${fmt(start)}/${fmt(end)}`,
    details: input.description,
    location: input.location,
  })
  return `https://calendar.google.com/calendar/render?${params.toString()}`
}

export function AddToCalendarButtons(props: AddToCalendarButtonsProps) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row">
      <a
        href={googleCalendarUrl(props)}
        target="_blank"
        rel="noreferrer"
        className="flex-1 rounded-md border border-border bg-background px-4 py-2 text-center text-sm font-medium text-slate-700 hover:bg-muted"
      >
        + Google Calendar
      </a>
      <a
        href={props.icsDownloadUrl}
        download="consulta.ics"
        className="flex-1 rounded-md border border-border bg-background px-4 py-2 text-center text-sm font-medium text-slate-700 hover:bg-muted"
      >
        + Apple Calendar (.ics)
      </a>
    </div>
  )
}
