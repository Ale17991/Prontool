# Contrato — rotas do portal do paciente

Interface pública desta feature: os endereços que o paciente alcança. Todos
públicos no roteamento (o middleware não exige sessão de staff) e todos
protegidos pela **sessão do paciente**, verificada por `openPortalPage`.

## Páginas

| Rota                                   | Seção exigida  | Conteúdo                                                                                                                                                           |
| -------------------------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `/paciente/[slug]`                     | —              | Login (CPF + nascimento). Sessão válida ⇒ redireciona ao painel.                                                                                                   |
| `/paciente/[slug]/painel`              | —              | Tela inicial: cabeçalho (com a próxima consulta, quando houver), metas, checklist, grade de cards. Sem metas nem checklist: texto de boas-vindas + área promovida. |
| `/paciente/[slug]/painel/evolucao`     | `metricas`     | Resumo dos indicadores + linha do tempo das medições.                                                                                                              |
| `/paciente/[slug]/painel/atendimentos` | `atendimentos` | Histórico de consultas.                                                                                                                                            |
| `/paciente/[slug]/painel/orientacoes`  | `orientacoes`  | Orientações escritas pela equipe.                                                                                                                                  |
| `/paciente/[slug]/painel/exames`       | `exames`       | Resultados com interpretação.                                                                                                                                      |
| `/paciente/[slug]/painel/treino`       | `treino`       | Rotina de treino ativa.                                                                                                                                            |
| `/paciente/[slug]/painel/dieta`        | `dieta`        | Plano alimentar entregue.                                                                                                                                          |

## Invariantes de toda página sob `/painel`

1. **Identidade só do cookie.** `tenantId` e `patientId` saem exclusivamente da
   sessão verificada. Nenhum parâmetro de rota ou query influencia de quem é o
   dado exibido — o `slug` identifica a CLÍNICA e é conferido contra o
   `tenantId` da sessão.
2. **Clínica inexistente ou com portal desligado** ⇒ `404`.
3. **Sessão ausente, inválida ou expirada** ⇒ redireciona para
   `/paciente/[slug]`, com `?sessao=expirada` quando havia cookie.
4. **Sessão de outra clínica** ⇒ mesmo tratamento do item 3. Cookie válido da
   clínica A não abre o portal da clínica B.
5. **Seção não habilitada** (desligada pela clínica ou fora do plano) ⇒
   redireciona para `/paciente/[slug]/painel`. Nunca `404`: a página existe, o
   que falta é permissão de vê-la.
6. **Toda abertura grava** uma linha em `patient_portal_access_log` com
   `action='view'` e `section` = a chave da área (`home` na tela inicial).
7. **Somente leitura.** A única escrita aceita do paciente segue sendo a
   marcação do checklist, por `/api/paciente/habitos`.

## Renovação de sessão — `POST /api/paciente/sessao`

Runtime **Node** (não middleware: Edge não tem `node:crypto` e o build quebra —
ver research D1). Disparada pelo layout do painel a cada página aberta.

| Situação                                               | Resposta                                                                  |
| ------------------------------------------------------ | ------------------------------------------------------------------------- |
| Cookie válido                                          | `200` + cookie reemitido com `expMs = agora + 30 min`; `iatMs` preservado |
| Cookie ausente, adulterado ou parado há mais de 30 min | `401` genérico; nada é reemitido                                          |
| `agora - iatMs >= 12h` (teto absoluto)                 | `401` genérico; não renova                                                |

Sem JavaScript no cliente a rota não é chamada, e a sessão volta a durar 30
minutos fixos — comportamento anterior à 057.

## Endpoints já existentes (sem mudança de contrato)

- `POST /api/paciente/login` — cria a sessão.
- `POST /api/paciente/logout` — encerra a sessão.
- `GET|POST /api/paciente/habitos` — grade e marcação do checklist.
- `GET /api/paciente/dados` — bundle completo. Continua existindo e não é usado
  pelas páginas (elas montam no servidor).
