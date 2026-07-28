# Quickstart — Lembretes por WhatsApp (051)

Como subir a feature e testá-la ponta a ponta em desenvolvimento.

> ⚠️ **O banco Supabase local é compartilhado com outra sessão de trabalho.** `vitest` chama
> `resetDatabase()` e apaga **todos** os dados e usuários. Combine antes de rodar a suíte, e
> re-semeie com `pnpm seed:demo` depois.

---

## 1. Pré-requisitos

**Serviço de WhatsApp** (repo `Homio-CRM/clinni-whatsapp`, projeto Supabase próprio) já
deployado e com as correções da Fase 0 aplicadas:

```bash
supabase link --project-ref <ref-do-projeto-whatsapp>
supabase db push
supabase secrets set EVOLUTION_API_URL=https://whatsapp.homio.com.br
supabase secrets set EVOLUTION_API_KEY=<apikey_global>
supabase functions deploy send-message provision-tenant status-webhook --no-verify-jwt
```

**Um celular com WhatsApp** que você possa escanear e desconectar à vontade. Não use o número
pessoal do dia a dia — o risco de bloqueio é real e foi aceito conscientemente.

---

## 2. Variáveis de ambiente no Clinni

```bash
WHATSAPP_SERVICE_URL=https://<projeto-whatsapp>.supabase.co/functions/v1
WHATSAPP_SERVICE_MASTER_KEY=<chave mestra de provisionamento>

# já existentes, necessários para o fluxo
PATIENT_DATA_ENCRYPTION_KEY=<...>   # cifra a api_key da clínica
QSTASH_TOKEN=<...>                  # espaçamento dos envios (opcional em dev)
NEXT_PUBLIC_APP_URL=http://localhost:3000
CRON_SECRET=<...>                   # para disparar o ciclo manualmente
```

Sem `QSTASH_TOKEN` o envio cai no modo inline com lote reduzido — suficiente para testar, não
para produção.

---

## 3. Migration

```bash
pnpm supabase:reset        # ⚠️ apaga o banco local — ver aviso no topo
pnpm supabase:gen-types
```

Em produção, **não** aplicar à mão: a integração GitHub da Supabase aplica no push para
`master`.

---

## 4. Conectar o número

1. Suba o app: `pnpm dev` (use `-p 3001` se a outra sessão já estiver na 3000).
2. Entre como **admin** da clínica.
3. `Configurações → WhatsApp → Conectar`.
4. Escaneie o QR com o celular de teste (WhatsApp → Aparelhos conectados).
5. O painel deve virar **Conectado** com o número aparecendo, em até ~30s.

Se o QR não aparecer: o braço não conseguiu falar com a Evolution. Confira
`supabase functions logs create-instance` no projeto do WhatsApp.

---

## 5. Mandar um lembrete de verdade

1. `Configurações → Lembretes`: ligue o motor, marque o canal **WhatsApp**, antecedência
   **24h**, janela larga (ex.: `00:00`–`23:59`) para não ser barrado pelo horário.
2. Cadastre um paciente com **o seu próprio celular** e `reminders_opt_in` ligado.
3. Marque uma consulta para **daqui a ~24h**.
4. Dispare o ciclo à mão:

```bash
curl -X POST http://localhost:3000/api/cron/send-reminders \
  -H "Authorization: Bearer $CRON_SECRET"
```

5. A mensagem chega no celular. Em `Configurações → Lembretes → Histórico` a linha aparece como
   **Enviada**; abra a mensagem no celular e o histórico deve progredir para **Entregue** e
   depois **Lida** (isso depende do callback estar alcançável — ver seção 6).

---

## 6. Receber as confirmações de entrega em dev

O braço precisa alcançar o seu localhost. Use um túnel:

```bash
# exemplo com cloudflared
cloudflared tunnel --url http://localhost:3000
```

E aponte o `callbackUrl` do tenant no braço para
`https://<seu-tunel>/api/webhooks/whatsapp-status`.

Sem túnel, o envio funciona normalmente — só a evolução para "entregue"/"lida" não chega.

---

## 7. Casos que valem testar à mão

| Cenário | Como forçar | Esperado |
|---|---|---|
| Paciente sem telefone | limpe o telefone do cadastro | lembrete fica `skipped_no_phone`, nada é enviado |
| Paciente recusou WhatsApp | desmarque o opt-in de WhatsApp | `skipped_opt_out_channel`; e-mail continua saindo se o canal estiver ligado |
| Número desconectado | desconecte o celular (WhatsApp → Aparelhos conectados → sair) | **uma** ocorrência `skipped_no_connection`, não uma por paciente |
| Envio duplicado | rode o `curl` do ciclo duas vezes seguidas | a segunda não gera mensagem nova |
| Confirmação forjada | `POST` no callback sem o Bearer | `401`, nada gravado |

---

## 8. Antes de dizer que terminou

```bash
pnpm typecheck
pnpm lint:auth      # rota de callback + segredos fora de adapter
pnpm test           # ⚠️ apaga o banco local — combine antes
```
