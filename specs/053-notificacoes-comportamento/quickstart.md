# Quickstart — Notificações por comportamento (053)

Como subir e exercitar a feature em desenvolvimento.

> ⚠️ **O banco Supabase local é compartilhado.** `pnpm test` e
> `pnpm supabase:reset` chamam `resetDatabase()` e apagam **todos** os dados e
> usuários. Combine antes e re-semeie com `pnpm seed:demo`.
> `npx vitest run tests/unit/<arquivo>` é seguro, não encosta no banco.

---

## 1. Migration e módulo

```bash
pnpm supabase:reset        # ⚠️ apaga o banco local
pnpm supabase:gen-types
pnpm seed:demo
```

Ligue o módulo `acompanhamento` para a clínica em `/admin` → clínica → módulos.
Sem ele a tela não abre **e o motor pula a clínica** — os dois gates existem de
propósito.

---

## 2. Variáveis de ambiente

Nenhuma nova. A feature usa o que já está configurado:

```bash
CRON_SECRET=<...>                   # dispara o ciclo à mão
QSTASH_TOKEN=<...>                  # espaçamento (opcional em dev)
PATIENT_DATA_ENCRYPTION_KEY=<...>   # decifra contato do paciente
WHATSAPP_SERVICE_URL=<...>          # canal WhatsApp
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

Sem `QSTASH_TOKEN` o envio cai no modo inline com lote reduzido.

---

## 3. O aceite, que é o primeiro tropeço

A base existente nasce **sem** `outreach_opt_in` (research D5). Se você ligar
uma regra e nada sair, é isto — não é bug.

Ligue o aceite num paciente de teste pela ficha dele, ou direto:

```sql
UPDATE patients SET outreach_opt_in = TRUE WHERE id = '<paciente-de-teste>';
```

---

## 4. Montar o cenário do hábito

1. Crie uma grade de hábitos para o paciente (ficha → Hábitos), com
   `start_date` de **pelo menos 10 dias atrás** — senão o piso da janela
   (research D10) impede o disparo, corretamente.
2. **Faça o paciente entrar no portal** ao menos uma vez, e registre pelo menos
   um acesso recente. Sem isso a regra é suprimida — e a supressão é o
   comportamento certo (D4), não uma falha.
3. Não marque nada nos últimos dias.

---

## 5. Ligar a regra e disparar

`Configurações → Notificações automáticas → Hábito sem registro`:
item do checklist, `3` dias, público "todos os ativos", canal "preferencial",
texto padrão. Salve.

```bash
curl -X POST http://localhost:3000/api/cron/patient-signals \
  -H "Authorization: Bearer $CRON_SECRET"
```

A resposta traz os contadores por desfecho. `enviadas: 1` e a mensagem chega.

---

## 6. Casos que valem testar à mão

| Cenário | Como forçar | Esperado |
|---|---|---|
| Silêncio | rodar o ciclo duas vezes seguidas | segunda rodada: `silenciada`, nenhuma mensagem nova |
| Idempotência | rodar duas vezes no mesmo dia | uma única ocorrência (unique por `cycle_date`) |
| Sumiço do portal | apagar os acessos recentes do paciente | `suprimida_sem_portal`, **e** a regra de reengajamento assume |
| Sem aceite | `outreach_opt_in = FALSE` | `sem_consentimento`, distinto de falha |
| Canal recusado | `reminders_whatsapp_opt_in = FALSE`, canal whatsapp | `sem_consentimento` |
| Teto global | 3 regras aplicáveis, teto 1 | 1 `enviada`, 2 `adiada`, escolha estável entre execuções |
| Grade nova | grade com `start_date` de ontem, regra de 5 dias | nada dispara |
| Texto acusatório | salvar texto com "você não fez" | `400 FORBIDDEN_PHRASE`, com a frase apontada |
| Placeholder inválido | texto com `{{peso}}` numa família que não oferece | `400 UNKNOWN_PLACEHOLDER` |
| Módulo revogado | desligar `acompanhamento` no `/admin` e rodar o ciclo | clínica pulada, sem mexer nas regras |
| Regra desligada no meio | desativar depois de enfileirar | worker cancela na revalidação |
| Paciente inativo | `status` do paciente ≠ ativo | não entra na avaliação |

---

## 7. Antes de dizer que terminou

```bash
pnpm typecheck
pnpm lint:auth      # rotas novas + worker isento por assinatura
pnpm test           # ⚠️ apaga o banco local — combine antes
```

O teste que mais importa não é nenhum destes: é **ler as cinco mensagens
padrão em voz alta** e perguntar se você as receberia sem se incomodar. Se
alguma soar como cobrança, o problema está no texto, não no motor.
