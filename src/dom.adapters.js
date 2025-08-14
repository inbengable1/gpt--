// dom.adapters.js — 找编辑器/容器 & 提取文本（精简、适配 GPTB）
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

  global.GPTB.dom = { getEditor, waitForSelector, getComposerScope, extractAssistantText };
  try { console.log('[mini] dom.adapters loaded'); } catch {}
})(typeof window !== 'undefined' ? window : this);
