/* dom.adapters.js — ChatGPT 批处理 · 页面适配与提取模块 (IIFE)
   暴露：window.GPTBatch.DOM
*/
(function (global) {
  'use strict';
  const NS = (global.GPTBatch = global.GPTBatch || {});

  /** 获取页面编辑器元素 **/
  function getEditorElement() {
    // 通过特定的选择器找到编辑器（聊天输入框）
    return document.querySelector('#prompt-textarea, [contenteditable="true"].ProseMirror');
  }

  /** 等待选择器（带超时） **/
  function waitForSelector(sel, timeout = 20000) {
    const t0 = Date.now();
    return new Promise((resolve, reject) => {
      const interval = setInterval(() => {
        const el = document.querySelector(sel);
        if (el) {
          clearInterval(interval);
          resolve(el);
        } else if (Date.now() - t0 >= timeout) {
          clearInterval(interval);
          reject(new Error(`等待元素超时：${sel}`));
        }
      }, 100);
    });
  }

  /** 粘贴文件到编辑器（通过 ClipboardEvent） **/
  function pasteFilesToEditor(editor, files) {
    const dt = new DataTransfer();
    files.forEach(f => dt.items.add(f));
    const evt = new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: dt });
    Object.defineProperty(evt, 'clipboardData', { value: dt });
    editor.dispatchEvent(evt);
  }

  /** 获取编辑器所在的表单容器（如包含输入框的表单） **/
  function getComposerScope(editor) {
    return editor.closest('form, [data-testid="composer"], [class*="composer"], [data-type*="composer"]')
           || editor.parentElement || document;
  }

  /** 提取助理的回复文本 **/
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

  /** 提取错误信息列表 **/
  function extractErrorList() {
    const errors = [];
    const root = document.querySelector('main') || document.body;
    root.querySelectorAll('.error-message, .error').forEach(err => {
      errors.push(err.innerText.trim());
    });
    return errors;
  }

  /** 启动进度提示 **/
  function showProgressMessage(message) {
    const progressMessage = document.createElement('div');
    progressMessage.textContent = message;
    progressMessage.style.position = 'fixed';
    progressMessage.style.top = '50%';
    progressMessage.style.left = '50%';
    progressMessage.style.transform = 'translate(-50%, -50%)';
    progressMessage.style.padding = '10px';
    progressMessage.style.backgroundColor = 'rgba(0, 0, 0, 0.7)';
    progressMessage.style.color = '#fff';
    progressMessage.style.borderRadius = '5px';
    progressMessage.style.zIndex = '999999';
    document.body.appendChild(progressMessage);

    // 自动消失
    setTimeout(() => {
      progressMessage.remove();
    }, 3000);
  }

  // 导出到命名空间
  NS.DOM = {
    getEditorElement,
    waitForSelector,
    pasteFilesToEditor,
    getComposerScope,
    extractAssistantText,
    extractErrorList,
    showProgressMessage
  };
})(typeof window !== 'undefined' ? window : this);
