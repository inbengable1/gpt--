// chat.ui.helpers.js — 识别发送/停止按钮并点击
(function (global) {
  'use strict';
  global.GPTB = global.GPTB || {};
  const H = {};

  function querySendStopButton(scope) {
    const root = scope || document;
    return (
      root.querySelector('button[data-testid="send-button"]') ||
      root.querySelector('button[aria-label*="Send"]') ||
      root.querySelector('button[data-testid="stop-button"]') ||
      root.querySelector('button[aria-label*="Stop"]') ||
      null
    );
  }

  function buttonMode(btn) {
    if (!btn) return 'unknown';
    const tid = (btn.getAttribute('data-testid') || '').toLowerCase();
    const aria = (btn.getAttribute('aria-label') || '').toLowerCase();
    const text = (btn.textContent || '').toLowerCase();
    if (tid.includes('stop') || aria.includes('stop') || text.includes('stop')) return 'stop';
    if (tid.includes('send') || aria.includes('send') || text.includes('send')) return 'send';
    return 'unknown';
  }

  function buttonEnabled(btn) {
    if (!btn) return false;
    if (btn.disabled) return false;
    const r = btn.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }

  async function waitButton(scope, want = 'send', mustEnabled = true, timeout = 20000) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeout) {
      const btn = querySendStopButton(scope);
      const okMode = buttonMode(btn) === want;
      const okEn   = mustEnabled ? buttonEnabled(btn) : true;
      if (okMode && okEn) return btn;
      await new Promise(r => setTimeout(r, 120));
    }
    return null;
  }

  async function trySend(scope) {
    const btn = querySendStopButton(scope);
    if (!btn) return false;
    btn.click();
    // 期望很快切换到 stop（表示已接受发送）
    const ok = await waitButton(scope, 'stop', false, 3000);
    return !!ok;
  }

  H.querySendStopButton = querySendStopButton;
  H.buttonMode = buttonMode;
  H.buttonEnabled = buttonEnabled;
  H.waitButton = waitButton;
  H.trySend = trySend;

  global.GPTB.uiHelpers = H;
  try { console.log('[mini] chat.ui.helpers loaded'); } catch {}
})(typeof window !== 'undefined' ? window : this);
