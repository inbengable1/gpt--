// control.runner.js — 最小入口：只负责在合适时机插UI
(function () {
  'use strict';
  function start(){
    try {
      if (typeof GPTB?.ui?.ensurePanel === 'function') {
        GPTB.ui.ensurePanel();
        console.log('[mini] runner started');
      } else {
        console.warn('[mini] UI not ready');
      }
    } catch (e) {
      console.error('[mini] start failed:', e);
    }
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();
