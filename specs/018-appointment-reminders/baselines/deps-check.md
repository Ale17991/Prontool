# Deps Check — Feature 018

**Date**: 2026-05-19

## Confirmadas presentes

- `date-fns ^4.1.0` (package.json) — funções puras (addDays, format, parseISO, etc.)
- `resend ^3.5.0` (package.json) — provider de email
- `next ^14.2.x` (App Router + Server Actions)
- `@supabase/ssr ^0.5.x` + `@supabase/supabase-js ^2.45.x`
- `zod ^3.23.x`
- `pino ^9.x`

## CORREÇÃO ao plan: `date-fns-tz` NÃO está instalado

Spec/plan/research mencionavam `date-fns-tz` "já presente" mas é falso premise. O projeto NÃO usa essa biblioteca — `grep -r "date-fns-tz" src/` retorna 0 hits.

### Decisão

Usar `Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', ... })` para formatar horários em TZ da clínica. Pattern já usado em:

- `src/components/public-booking/slot-picker.tsx`
- `src/components/public-booking/patient-form.tsx`
- `src/lib/integrations/email/booking-template.ts` (feature 017)

Para cálculos de janela "hora local atual" e "está dentro de window_start/window_end", usar conversão manual: `new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo', hour12: false })` → parse hora/minuto.

Sem nova dependência necessária.
