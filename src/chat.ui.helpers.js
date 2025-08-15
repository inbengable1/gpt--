// chat.ui.helpers.js — ChatGPT 发送/停止按钮 & 发送策略（基于 GPTB.dom.getComposerScope）
// 依赖：GPTB.utils.sleep、GPTB.dom.getComposerScope、（可选）GPTB.conf.{QUIET_MS,UPLOAD_READY_TIMEOUT_MS,SEND_ACCEPT_TIMEOUT_MS}
(function (global) {
  'use strict';
  global.GPTB = global.GPTB || {};
  const H = {};

  const C = Object.assign({
    QUIET_MS: 500,
    UPLOAD_READY_TIMEOUT_MS: 60000,
    SEND_ACCEPT_TIMEOUT_MS: 3000
  }, (global.GPTB.conf || {}));

  const U = global.GPTB.utils || {
    sleep: (ms)=>new Promise(r=>setTimeout(r,ms))
  };

  // —— 定位按钮（在 composer 作用域内查找）——
  function querySendStopButtonInScope(scope) {
    const root = scope || document;
    // 尽量覆盖常见 DOM 变体
    return (
      root.querySelector('#composer-submit-button') ||
      root.querySelector('button[data-testid="send-button"]') ||
      root.querySelector('button[data-testid="stop-button"]') ||
      root.querySelector('button[aria-label*="Send"]') ||
      root.querySelector('button[aria-label*="Stop"]') ||
      root.querySelector('button[type="submit"]') ||
      null
    );
  }

  // —— 判定模式：send / stop / unknown ——
  function buttonMode(btn) {
    if (!btn) return 'unknown';
    const tid  = (btn.getAttribute('data-testid')  || '').toLowerCase();
    const aria = (btn.getAttribute('aria-label')   || '').toLowerCase();
    const txt  = (btn.textContent || '').toLowerCase();
    if (tid.includes('stop') || aria.includes('stop') || txt.includes('stop') || aria.includes('停止')) return 'stop';
    if (tid.includes('send') || aria.includes('send') || txt.includes('send') || aria.includes('发送')) return 'send';
    return 'unknown';
  }

  // —— 判定可点击：未禁用、未 busy、可见且有尺寸 ——
  function buttonEnabled(btn) {
    if (!btn) return false;
    if (btn.disabled) return false;
    if (btn.getAttribute('aria-disabled') === 'true') return false;
    if (btn.getAttribute('aria-busy') === 'true') return false;
    const r = btn.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return false;
    // 周围容器处于 loading/busy 也视为不可点击
    if (btn.closest('[aria-busy="true"], [data-state*="loading"], [data-loading="true"]')) return false;
    // display:none（offsetParent 为 null）
    if (btn.offsetParent === null) return false;
    return true;
  }

  // —— 等待按钮满足指定状态（模式 & 可用性），超时返回 null ——
  async function waitButton(scope, wantMode = null, wantEnabled = null, timeoutMs = 20000) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) {
      const btn = querySendStopButtonInScope(scope);
      const okMode = (wantMode == null) || (buttonMode(btn) === wantMode);
      const okEn   = (wantEnabled == null) || (buttonEnabled(btn) === wantEnabled);
      if (btn && okMode && okEn) return btn;
      await U.sleep(120);
    }
    return null;
  }

  // —— 上传完成 & 可发送：等待 send+enabled 连续稳定 stableMs（默认 500ms） ——
  async function waitReadyToSend(scope, { timeout = C.UPLOAD_READY_TIMEOUT_MS, stableMs = C.QUIET_MS } = {}) {
    const t0 = Date.now();
    let stableStart = 0;
    while (Date.now() - t0 < timeout) {
      const btn = querySendStopButtonInScope(scope);
      const ok = btn && buttonMode(btn) === 'send' && buttonEnabled(btn);
      if (ok) {
        if (!stableStart) stableStart = Date.now();
        if (Date.now() - stableStart >= (stableMs || 0)) return true; // 连续稳定
      } else {
        stableStart = 0;
      }
      await U.sleep(120);
    }
    return false;
  }

  // —— 基于“按钮状态”的上传完成等待（与旧版命名保持兼容） ——
  async function waitUploadReadyByButton(editor, timeout = C.UPLOAD_READY_TIMEOUT_MS) {
    const scope = (global.GPTB.dom && global.GPTB.dom.getComposerScope && global.GPTB.dom.getComposerScope(editor)) || document;
    return waitReadyToSend(scope, { timeout, stableMs: C.QUIET_MS });
  }

  // —— 回车发送（比点击更稳） ——
  function pressEnterInEditor(editor) {
    if (!editor) return false;
    try { editor.focus(); } catch {}
    const opts = { bubbles:true, cancelable:true, key:'Enter', code:'Enter', keyCode:13, which:13 };
    editor.dispatchEvent(new KeyboardEvent('keydown',  opts));
    editor.dispatchEvent(new KeyboardEvent('keypress', opts));
    editor.dispatchEvent(new KeyboardEvent('keyup',    opts));
    return true;
  }

  // —— 一条龙：等待可发送 → 回车提交 ——
  async function waitAndSubmitByEnter(scope, editor, { timeout=C.UPLOAD_READY_TIMEOUT_MS, stableMs=C.QUIET_MS } = {}) {
    const ok = await waitReadyToSend(scope, { timeout, stableMs });
    if (!ok) return false;
    return pressEnterInEditor(editor);
  }

  // —— 点击发送（备用方案）：点击后短时间内应切到 stop ——
  async function clickSend(scope) {
    const btn = querySendStopButtonInScope(scope);
    if (!btn) return false;
    btn.click();
    const switched = await waitButton(scope, 'stop', null, C.SEND_ACCEPT_TIMEOUT_MS);
    return !!switched;
  }

  // —— 综合发送接口：优先回车；如需可选 method:'click' ——
  async function trySend(scope, editor, { method = 'enter', timeout=C.UPLOAD_READY_TIMEOUT_MS, stableMs=C.QUIET_MS } = {}) {
    if (method === 'click') {
      const ok = await waitReadyToSend(scope, { timeout, stableMs });
      if (!ok) return false;
      return clickSend(scope);
    }
    // 默认：回车策略
    return waitAndSubmitByEnter(scope, editor, { timeout, stableMs });
  }

  // —— 等助手生成后“安静一段时间”（避免截断提取） ——
  async function waitAssistantIdle(quietMs = C.QUIET_MS, maxMs = 4000) {
    const root = document.querySelector('main') || document.body;
    let last = root.innerText.length;
    let stillStart = 0;
    const t0 = Date.now();
    while (Date.now() - t0 < maxMs) {
      const cur = root.innerText.length;
      if (cur === last) {
        if (!stillStart) stillStart = Date.now();
        if (Date.now() - stillStart >= (quietMs || 0)) return true;
      } else {
        stillStart = 0;
        last = cur;
      }
      await U.sleep(120);
    }
    return true;
  }

  // —— 导出 —— 
  H.querySendStopButtonInScope = querySendStopButtonInScope;
  H.buttonMode = buttonMode;
  H.buttonEnabled = buttonEnabled;
  H.waitButton = waitButton;
  H.waitReadyToSend = waitReadyToSend;
  H.waitUploadReadyByButton = waitUploadReadyByButton;
  H.pressEnterInEditor = pressEnterInEditor;
  H.waitAndSubmitByEnter = waitAndSubmitByEnter;
  H.clickSend = clickSend;
  H.trySend = trySend;
  H.waitAssistantIdle = waitAssistantIdle;

  global.GPTB.uiHelpers = H;
  try { console.log('[mini] chat.ui.helpers loaded (buttons/send)'); } catch {}
})(typeof window !== 'undefined' ? window : this);
