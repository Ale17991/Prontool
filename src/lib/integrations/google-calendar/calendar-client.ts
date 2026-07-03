/**
 * Wrapper fino (fetch nativo) sobre a Google Calendar API v3. Sem deps.
 * O caller obtém o access_token via `withGoogleAuth`. Timeout 10s.
 */

const API_BASE = 'https://www.googleapis.com/calendar/v3/calendars'

export class GoogleCalendarApiError extends Error {
  readonly status: number
  /** `true` quando o evento não existe mais (404/410) — caller pode ignorar no delete. */
  readonly gone: boolean
  constructor(message: string, status: number) {
    super(message)
    this.name = 'GoogleCalendarApiError'
    this.status = status
    this.gone = status === 404 || status === 410
  }
}

export interface CalendarEventInput {
  summary: string
  description?: string | null
  location?: string | null
  /** Início (ISO 8601, UTC). */
  startIso: string
  /** Fim (ISO 8601, UTC). */
  endIso: string
  /** IANA timezone (ex.: 'America/Sao_Paulo'). */
  timeZone: string
}

function eventBody(input: CalendarEventInput): Record<string, unknown> {
  return {
    summary: input.summary,
    description: input.description ?? undefined,
    location: input.location ?? undefined,
    start: { dateTime: input.startIso, timeZone: input.timeZone },
    end: { dateTime: input.endIso, timeZone: input.timeZone },
  }
}

async function call(
  accessToken: string,
  path: string,
  method: 'POST' | 'PATCH' | 'DELETE',
  body?: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const res = await fetch(`${API_BASE}/${path}`, {
    method,
    headers: {
      authorization: `Bearer ${accessToken}`,
      'content-type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(10000),
  })
  if (method === 'DELETE') {
    if (!res.ok && res.status !== 404 && res.status !== 410) {
      throw new GoogleCalendarApiError(`DELETE ${path} → ${res.status}`, res.status)
    }
    return {}
  }
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>
  if (!res.ok) {
    throw new GoogleCalendarApiError(
      `${method} ${path} → ${res.status} ${JSON.stringify(json)}`,
      res.status,
    )
  }
  return json
}

export interface BusyInterval {
  /** ISO 8601 UTC. */
  start: string
  end: string
}

/**
 * Horários OCUPADOS do calendário no intervalo [timeMin, timeMax) — via FreeBusy.
 * Retorna só os intervalos busy, SEM título/detalhe (privacidade — "só o bloqueio").
 */
export async function getFreeBusy(
  accessToken: string,
  calendarId: string,
  timeMinIso: string,
  timeMaxIso: string,
): Promise<BusyInterval[]> {
  const res = await fetch('https://www.googleapis.com/calendar/v3/freeBusy', {
    method: 'POST',
    headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
    body: JSON.stringify({ timeMin: timeMinIso, timeMax: timeMaxIso, items: [{ id: calendarId }] }),
    signal: AbortSignal.timeout(10000),
  })
  const json = (await res.json().catch(() => ({}))) as {
    calendars?: Record<string, { busy?: Array<{ start: string; end: string }> }>
  }
  if (!res.ok)
    throw new GoogleCalendarApiError(`freeBusy → ${res.status} ${JSON.stringify(json)}`, res.status)
  const busy = json.calendars?.[calendarId]?.busy ?? []
  return busy.filter((b) => b.start && b.end).map((b) => ({ start: b.start, end: b.end }))
}

/** Cria um evento. Retorna o id do evento no Google. */
export async function createCalendarEvent(
  accessToken: string,
  calendarId: string,
  input: CalendarEventInput,
): Promise<string> {
  const json = await call(
    accessToken,
    `${encodeURIComponent(calendarId)}/events`,
    'POST',
    eventBody(input),
  )
  const id = json.id
  if (typeof id !== 'string')
    throw new GoogleCalendarApiError('createCalendarEvent: sem id na resposta', 500)
  return id
}

/** Atualiza um evento existente (reagendamento). */
export async function patchCalendarEvent(
  accessToken: string,
  calendarId: string,
  eventId: string,
  input: CalendarEventInput,
): Promise<void> {
  await call(
    accessToken,
    `${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
    'PATCH',
    eventBody(input),
  )
}

/** Remove um evento (cancelamento/estorno). 404/410 = já não existe → no-op. */
export async function deleteCalendarEvent(
  accessToken: string,
  calendarId: string,
  eventId: string,
): Promise<void> {
  await call(
    accessToken,
    `${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
    'DELETE',
  )
}
