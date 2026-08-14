/**
 * O Google concede escopo A ESCOLHA DO USUÁRIO: a tela de permissões granulares
 * mostra uma caixa por escopo, e a da agenda vem DESMARCADA. Quem clica em
 * "Continuar" sem marcar concede só o e-mail — e nós gravávamos isso como
 * conexão boa. O card dizia "conectada", e a falha só aparecia no primeiro
 * atendimento, como um 403 `ACCESS_TOKEN_SCOPE_INSUFFICIENT` dentro de
 * `appointment_calendar_sync.last_error`, onde ninguém olha. Aconteceu em
 * 2026-08-14 com o primeiro profissional conectado em produção.
 *
 * Este é o predicado que decide se o consentimento serve. Os dois casos que
 * importam são opostos e fáceis de errar: recusar quem concedeu de MENOS, e
 * NÃO recusar quem concedeu de mais.
 */
import { describe, expect, it } from 'vitest'
import { grantsCalendarWrite } from '@/lib/integrations/google-calendar/oauth/client'

const EVENTS = 'https://www.googleapis.com/auth/calendar.events'
const FULL = 'https://www.googleapis.com/auth/calendar'
const EMAIL = 'https://www.googleapis.com/auth/userinfo.email'
const READONLY = 'https://www.googleapis.com/auth/calendar.readonly'

describe('grantsCalendarWrite', () => {
  it('aceita o escopo que pedimos', () => {
    expect(grantsCalendarWrite([EMAIL, EVENTS])).toBe(true)
  })

  it('aceita acesso TOTAL à agenda — quem concedeu mais não pode ser recusado', () => {
    // include_granted_scopes=true pode trazer permissão ampla de uma
    // autorização anterior. Recusar seria bloquear uma conexão que funciona.
    expect(grantsCalendarWrite([EMAIL, FULL])).toBe(true)
  })

  it('recusa quando só o e-mail foi concedido — o caso real de 14/08', () => {
    expect(grantsCalendarWrite([EMAIL])).toBe(false)
  })

  it('recusa leitura de agenda: ler não é criar evento', () => {
    // O sync faz INSERT. `calendar.readonly` passaria no login e falharia com
    // 403 no primeiro atendimento — exatamente o que este teste evita.
    expect(grantsCalendarWrite([EMAIL, READONLY])).toBe(false)
  })

  it('recusa lista vazia', () => {
    expect(grantsCalendarWrite([])).toBe(false)
  })

  it('não aceita prefixo parecido — a comparação é do escopo inteiro', () => {
    expect(grantsCalendarWrite(['https://www.googleapis.com/auth/calendar.events.readonly'])).toBe(
      false,
    )
  })
})
