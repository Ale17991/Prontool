/**
 * Stub do SDK Sinapse Prescrição da Memed — SOMENTE E2E (spec 027).
 *
 * O Playwright intercepta a URL do script real (`page.route`) e responde com
 * este arquivo. Ele reproduz o contrato que o launcher do Clinni consome:
 *   - `window.MdSinapsePrescricao.event.add('core:moduleInit', cb)`
 *   - `MdHub` como global (o launcher lê via typeof-guard)
 *   - `MdHub.module.show('plataforma.prescricao')` → injeta o iframe stub
 *   - `MdHub.command.send(..., 'setPaciente', payload)` → repassa ao iframe
 *   - eventos `prescricaoImpressa`/`prescricaoExcluida` vindos do iframe
 *
 * Helpers de teste (caminho completo, passando pelo iframe de verdade):
 *   window.__emitPrescricaoImpressa({ id })
 *   window.__emitPrescricaoExcluida({ id })
 *   window.__emitFeatureToggle({ feature, enabled })
 */
;(function () {
  'use strict'

  var script = document.currentScript
  var token = script && script.dataset ? script.dataset.token : ''
  var mockBase = window.__memedMockBase || 'http://localhost:4001'

  var sinapseListeners = {}
  var hubListeners = {}
  var iframe = null

  function addListener(map, event, cb) {
    if (!map[event]) map[event] = []
    map[event].push(cb)
  }
  function emit(map, event, payload) {
    var cbs = map[event] || []
    for (var i = 0; i < cbs.length; i++) {
      try {
        cbs[i](payload)
      } catch (e) {
        /* listener defeituoso não derruba o stub */
      }
    }
  }

  window.MdSinapsePrescricao = {
    event: {
      add: function (event, cb) {
        addListener(sinapseListeners, event, cb)
      },
    },
  }

  // O launcher acessa `MdHub` por nome léxico (typeof-guard) — uma propriedade
  // de window resolve a referência global do mesmo jeito.
  window.MdHub = {
    command: {
      send: function (_module, command, payload) {
        if (command === 'setPaciente') {
          window.__lastSetPaciente = payload
          if (iframe && iframe.contentWindow) {
            iframe.contentWindow.postMessage({ command: 'setPaciente', data: payload }, '*')
          }
        }
        if (command === 'logout' && iframe && iframe.contentWindow) {
          iframe.contentWindow.postMessage({ command: 'logout' }, '*')
        }
        return Promise.resolve()
      },
    },
    event: {
      add: function (event, cb) {
        addListener(hubListeners, event, cb)
      },
    },
    module: {
      show: function (name) {
        var prev = document.getElementById('memed-iframe-stub')
        if (prev) prev.remove()
        iframe = document.createElement('iframe')
        iframe.id = 'memed-iframe-stub'
        iframe.src = mockBase + '/iframe-stub.html'
        iframe.setAttribute('data-token', token || '')
        iframe.style.width = '100%'
        iframe.style.height = '420px'
        iframe.style.border = '0'
        document.body.appendChild(iframe)
        iframe.addEventListener('load', function () {
          // SDK real demora ~200ms entre load e moduleInit — simulado aqui.
          setTimeout(function () {
            emit(sinapseListeners, 'core:moduleInit', { name: name })
          }, 200)
        })
      },
    },
  }

  // Eventos emitidos pelo iframe stub sobem por postMessage e chegam aos
  // listeners ligados via MdHub.event.add — igual ao SDK real.
  window.addEventListener('message', function (e) {
    var d = e.data
    if (!d || typeof d !== 'object') return
    if (d.event === 'prescricaoImpressa') emit(hubListeners, 'prescricaoImpressa', d.data)
    if (d.event === 'prescricaoExcluida') emit(hubListeners, 'prescricaoExcluida', d.data)
    if (d.command === 'setFeatureToggle') {
      window.__lastFeatureToggle = { feature: d.feature, enabled: d.enabled }
    }
  })

  function forwardToIframe(message) {
    if (!iframe || !iframe.contentWindow) throw new Error('iframe stub não carregado')
    iframe.contentWindow.postMessage(message, '*')
  }
  window.__emitPrescricaoImpressa = function (data) {
    forwardToIframe({ command: '__emit', event: 'prescricaoImpressa', data: data })
  }
  window.__emitPrescricaoExcluida = function (data) {
    forwardToIframe({ command: '__emit', event: 'prescricaoExcluida', data: data })
  }
  window.__emitFeatureToggle = function (args) {
    forwardToIframe({
      command: '__emit',
      event: 'setFeatureToggle',
      feature: args.feature,
      enabled: args.enabled,
    })
  }
})()
