// dom.adapters.js — 找编辑器/容器 & 提取文本 + 按钮状态检测（适配 GPTB）
(function (global) {
  'use strict';
  global.GPTB = global.GPTB || {};

  // 找到当前可用的编辑器（优先可见节点）
  function getEditor() {
    const candidates = document.querySelectorAll('#prompt-textarea, [contenteditable="true"].ProseMirror');
    for (const el of candidates) {
      const r = el.getBoundingClientRect();
      const visible = r.width > 0 && r.height > 0;
      if (visible) return el;
    }
    return candidates[0] || null;
  }

  // 等待选择器出现；超时返回 null（不抛错，交由上层处理）
  function waitForSelector(sel, timeout = 20000) {
    const t0 = Date.now();
    return new Promise((resolve) => {
      const tick = setInterval(() => {
        const el = document.querySelector(sel);
        if (el) { clearInterval(tick); resolve(el); }
        else if (Date.now() - t0 >= timeout) { clearInterval(tick); resolve(null); }
      }, 100);
    });
  }

  // 编辑器所在的“composer”作用域（供后续查发送按钮等）
  function getComposerScope(editor) {
    const el = editor || getEditor();
    if (!el) return document;
    return el.closest('form, [data-testid="composer"], [class*="composer"], [data-type*="composer"]')
        || el.parentElement || document;
  }

  // 提取助手文本（含代码块）
  function extractAssistantText() {
    const root = document.querySelector('main') || document.body;
    const lines = [];
    root.querySelectorAll('p[data-start][data-end], li[data-start][data-end], h1[data-start][data-end], h2[data-start][data-end], h3[data-start][data-end]')
      .forEach(n => { const t = n.innerText.trim(); if (t) lines.push(t); });
    root.querySelectorAll('pre code').forEach(code => {
      const lang = code.getAttribute('data-language') ||
                   [...(code.classList || [])].find(c => c.startsWith('language-'))?.replace('language-', '') || '';
      const body = code.innerText.replace(/\s+$/, '');
      if (body) lines.push('```' + lang + '\n' + body + '\n```');
    });
    if (!lines.length) {
      const last = [...(root.querySelectorAll('[data-message-author-role="assistant"]'))].pop();
      const fallback = (last || root).innerText?.trim();
      if (fallback) lines.push(fallback);
    }
    return lines.join('\n').replace(/\n{3,}/g, '\n\n');
  }

  // ==========================
  // 按钮状态检测（简洁且健壮）
  // ==========================

  // 在作用域中查找发送/停止按钮
  function getSendStopButton(scope) {
    const root = scope || document;
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

  // 返回 'send' / 'stop' / 'unknown'
  function getButtonMode(btn) {
    if (!btn) return 'unknown';
    const tid  = (btn.getAttribute('data-testid')  || '').toLowerCase();
    const aria = (btn.getAttribute('aria-label')   || '').toLowerCase();
    const txt  = (btn.textContent || '').toLowerCase();
    if (tid.includes('stop') || aria.includes('stop') || txt.includes('stop') || aria.includes('停止')) return 'stop';
    if (tid.includes('send') || aria.includes('send') || txt.includes('send') || aria.includes('发送')) return 'send';
    return 'unknown';
  }

  // 按钮是否可点击（未禁用、未 busy、可见且有尺寸）
  function isButtonEnabled(btn) {
    if (!btn) return false;
    if (btn.disabled) return false;
    if (btn.getAttribute('aria-disabled') === 'true') return false;
    if (btn.getAttribute('aria-busy') === 'true') return false;
    const r = btn.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return false;
    if (btn.closest('[aria-busy="true"], [data-state*="loading"], [data-loading="true"]')) return false;
    if (btn.offsetParent === null) return false;
    return true;
  }

  // 等到按钮处于 send 且 enabled，连续稳定 stableMs 毫秒（默认 500ms）
  async function waitReadyToSend(scope, { timeout = 60000, stableMs = 500 } = {}) {
    const t0 = Date.now();
    let stableStart = 0;
    while (Date.now() - t0 < timeout) {
      const btn = getSendStopButton(scope);
      const ok = btn && getButtonMode(btn) === 'send' && isButtonEnabled(btn);
      if (ok) {
        if (!stableStart) stableStart = Date.now();
        if (Date.now() - stableStart >= stableMs) return true; // 连续稳定
      } else {
        stableStart = 0;
      }
      await new Promise(r => setTimeout(r, 120));
    }
    return false;
  }

  global.GPTB.dom = {
    getEditor,
    waitForSelector,
    getComposerScope,
    extractAssistantText,
    // 按钮检测
    getSendStopButton,
    getButtonMode,
    isButtonEnabled,
    waitReadyToSend
  };

  try { console.log('[mini] dom.adapters loaded (+button state)'); } catch {}
})(typeof window !== 'undefined' ? window : this);
