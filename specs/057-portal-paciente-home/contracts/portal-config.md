# Contrato — configuração do portal (texto de boas-vindas)

Extensão do contrato existente de `/configuracoes/portal-paciente`. Não há rota
HTTP nova: a tela usa Server Actions, e o campo entra no fluxo que já grava
`patient_portal_enabled`.

## Autorização

Inalterada: action `patient_portal.config` (admin), avaliada **no servidor**.
Ocultar o campo na interface não é o controle — é consequência dele
(Princípio V).

## Leitura — `getPatientPortalConfig`

```ts
interface PatientPortalConfig {
  patientPortalEnabled: boolean
  publicBookingSlug: string | null
  welcomeText: string | null // NOVO
}
```

`welcomeText` é `null` quando a clínica nunca escreveu nada.

## Escrita — `PatientPortalConfigUpdateSchema`

Campo novo:

| Campo         | Tipo             | Regra                                                                   |
| ------------- | ---------------- | ----------------------------------------------------------------------- |
| `welcomeText` | `string \| null` | Máximo **1.000** caracteres. Vazio ou só espaços ⇒ gravado como `NULL`. |

**Normalização obrigatória**: `''` e `'   '` viram `NULL` antes de gravar.
Guardar string vazia criaria um terceiro estado indistinguível de "sem texto"
na leitura, mas distinguível no banco — divergência que só apareceria num
relatório meses depois.

**Sem HTML**: o valor é renderizado como texto puro, preservando quebras de
linha. Nada de marcação — é recado curto, e aceitar HTML num texto que vai para
tela de paciente abriria superfície de injeção sem necessidade.

## Consumo no portal

O texto **só é exibido** quando nem metas nem checklist têm o que exibir
(FR-017). Clínica com texto cadastrado e paciente com metas ativas **não vê o
texto** — ele preenche uma tela que ficaria vazia, não é recado permanente.
