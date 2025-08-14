(function (global) {
  'use strict';
  global.GPTB = global.GPTB || {};
  // 仅保留最小配置，后续再逐步加
  global.GPTB.conf = {
    PANEL_ID: 'gptb-mini-panel'
  };
  try { console.log('[mini] conf loaded'); } catch {}
})(typeof window !== 'undefined' ? window : this);
