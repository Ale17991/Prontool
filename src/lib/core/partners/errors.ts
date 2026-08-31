/**
 * Erro que as rotas de parceiro convertem em resposta HTTP.
 *
 * Mora em arquivo próprio, e não no guard, porque o modelo de leitura também
 * precisa levantá-lo — e o modelo de leitura não deve importar nada que fale
 * HTTP para conseguir dizer "este período é grande demais".
 */
export class PartnerDenied extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly publicMessage: string,
  ) {
    super(code)
    this.name = 'PartnerDenied'
  }
}
