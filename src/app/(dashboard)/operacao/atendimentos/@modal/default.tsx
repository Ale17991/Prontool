/**
 * Default do slot `@modal` para parallel routes. Renderiza `null` quando
 * a rota atual não intercepta nada — sem este arquivo, navegação para
 * qualquer rota irmã (lista, /novo, /bloquear) dispara 404 porque o Next
 * não sabe o que servir no slot.
 */
export default function ModalDefault() {
  return null
}
