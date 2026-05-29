'use client'

interface AddToCalendarButtonsProps {
  title: string
  description: string
  location: string
  startIso: string
  durationMinutes: number
  /** URL do .ics — servido com Content-Disposition: inline para abrir nativo. */
  icsDownloadUrl: string
}

function utcStamp(d: Date): string {
  return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(
    d.getUTCDate(),
  ).padStart(2, '0')}T${String(d.getUTCHours()).padStart(2, '0')}${String(
    d.getUTCMinutes(),
  ).padStart(2, '0')}00Z`
}

function googleCalendarUrl(input: AddToCalendarButtonsProps): string {
  const start = new Date(input.startIso)
  const end = new Date(start.getTime() + input.durationMinutes * 60 * 1000)
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: input.title,
    dates: `${utcStamp(start)}/${utcStamp(end)}`,
    details: input.description,
    location: input.location,
  })
  return `https://calendar.google.com/calendar/render?${params.toString()}`
}

function outlookCalendarUrl(input: AddToCalendarButtonsProps): string {
  // Deeplink do Outlook Web (calendar.live.com). ISO 8601 com offset.
  const start = new Date(input.startIso)
  const end = new Date(start.getTime() + input.durationMinutes * 60 * 1000)
  const params = new URLSearchParams({
    path: '/calendar/action/compose',
    rru: 'addevent',
    subject: input.title,
    startdt: start.toISOString(),
    enddt: end.toISOString(),
    body: input.description,
    location: input.location,
    allday: 'false',
  })
  return `https://outlook.live.com/calendar/0/deeplink/compose?${params.toString()}`
}

export function AddToCalendarButtons(props: AddToCalendarButtonsProps) {
  return (
    <div className="grid gap-2 sm:grid-cols-3">
      <a
        href={googleCalendarUrl(props)}
        target="_blank"
        rel="noreferrer"
        className="rounded-md border border-border bg-background px-4 py-2 text-center text-sm font-medium text-slate-700 hover:bg-muted"
      >
        Google Calendar
      </a>
      <a
        href={outlookCalendarUrl(props)}
        target="_blank"
        rel="noreferrer"
        className="rounded-md border border-border bg-background px-4 py-2 text-center text-sm font-medium text-slate-700 hover:bg-muted"
      >
        Outlook
      </a>
      {/* Sem `download` para que iOS/macOS Safari abram direto no
          Calendar.app via .ics inline. Em Windows/Android o navegador
          escolhe entre abrir no app default ou baixar. */}
      <a
        href={props.icsDownloadUrl}
        target="_blank"
        rel="noreferrer"
        className="rounded-md border border-border bg-background px-4 py-2 text-center text-sm font-medium text-slate-700 hover:bg-muted"
      >
        Apple Calendar
      </a>
    </div>
  )
}
