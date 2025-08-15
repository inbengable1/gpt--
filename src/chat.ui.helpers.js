// chat.ui.helpers.js — 从存储取文件→粘贴→等待可发→填prompt→回车提交→（可选）抓取并保存回复
(function (global) {
  'use strict';
  global.GPTB = global.GPTB || {};
  const H = {};

  const U  = global.GPTB.utils    || {};
  const ST = global.GPTB.storage  || {};
  const D  = global.GPTB.dom      || {};
  const UP = global.GPTB.uploader || {};

  const sleep = (ms)=>new Promise(r=>setTimeout(r, ms));
  const toast = (msg)=> (U.toast ? U.toast(msg) : console.log('[gptb]', msg));

  function getPromptFromUI(optsPrompt) {
    if (typeof optsPrompt === 'string') return optsPrompt;
    const pid = global.GPTB.conf?.PROMPT_INPUT_ID;
    const el  = (pid && document.getElementById(pid))
             || document.getElementById('gptb-prompt')
             || document.getElementById('gptb-mini-prompt');
    return (el && el.value) ? String(el.value) : '';
  }

  // 兼容 textarea(#prompt-textarea) & ProseMirror(contenteditable) 的文本写入
  function typePromptIntoEditor(editor, text) {
    if (!editor || !text) return false;
    // textarea
    if (editor.tagName === 'TEXTAREA' || editor.id === 'prompt-textarea') {
      try {
        const ta = editor;
        const prev = ta.value || '';
        ta.focus();
        ta.value = prev ? (prev.endsWith(' ') ? prev + text : prev + ' ' + text) : text;
        ta.dispatchEvent(new Event('input', { bubbles: true }));
        return true;
      } catch {}
    }
    // contenteditable
    try {
      editor.focus();
      const ok = document.execCommand && document.execCommand('insertText', false, text);
      if (!ok) {
        const span = document.createElement('span');
        span.textContent = text;
        editor.appendChild(span);
      }
      return true;
    } catch {}
    return false;
  }

  async function getEditorOrWait(sel = '#prompt-textarea', timeout = 20000) {
    const ed = D.getEditor?.();
    if (ed) return ed;
    return await D.waitForSelector?.(sel, timeout);
  }

  /*** 新增：回复期“写一个字符”，确保结束时按钮回到 send 可点 ***/
  function nudgeEditorForReply(editor) {
    const ed = editor;
    if (!ed) return false;
    try {
      // textarea
      if (ed.tagName === 'TEXTAREA' || ed.id === 'prompt-textarea') {
        const prev = ed.value || '';
        ed.value = prev + (prev.endsWith(' ') ? 'a' : ' a');
        ed.dispatchEvent(new Event('input', { bubbles: true }));
        return true;
      }
      // contenteditable
      ed.focus();
      const ok = document.execCommand && document.execCommand('insertText', false, 'a');
      if (!ok) {
        const span = document.createElement('span'); span.textContent = 'a';
        ed.appendChild(span);
      }
      // 某些实现需要一个 input-like 事件来刷新按钮
      ed.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    } catch {}
    return false;
  }

  /*** 新增：等待按钮回到 send 且可点击（表示生成结束） ***/
  async function waitReplyDone(scope, { timeout = 60000, stableMs = 400 } = {}) {
    // 直接复用 dom.adapters 提供的判定：send + enabled 连续稳定
    return !!(await D.waitReadyToSend?.(scope, { timeout, stableMs }));
  }

  /*** 新增：等待页面在 quietMs 内保持“无变化”，避免过早抓取 ***/
  async function waitAssistantIdle(quietMs = 500, hardMs = 4000) {
    const root = document.querySelector('main') || document.body;
    let lastLen = 0, quietStart = 0;
    const t0 = Date.now();
    return new Promise((resolve) => {
      const mo = new MutationObserver(() => {
        const last = [...root.querySelectorAll('[data-message-author-role="assistant"]')].pop();
        const len = last ? (last.innerText || '').length : 0;
        if (len !== lastLen) { lastLen = len; quietStart = Date.now(); }
      });
      mo.observe(root, { childList: true, subtree: true, characterData: true });
      const tick = setInterval(() => {
        if (quietStart && Date.now() - quietStart >= quietMs) {
          clearInterval(tick); mo.disconnect(); resolve(true);
        }
        if (Date.now() - t0 >= hardMs) {
          clearInterval(tick); mo.disconnect(); resolve(true); // 兜底放行
        }
      }, 120);
    });
  }

  /*** 新增：保存文本为文件（reply-时间戳.txt 或自定义前缀） ***/
  function saveTextAsFile(text, base = 'reply') {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `${base}-${stamp}.txt`; a.click();
    URL.revokeObjectURL(url);
  }

  /*** 新增：抓取并保存最新助手回复 ***/
  async function captureAndSaveReply({ baseName = 'reply', quietMs = 500, hardMs = 4000 } = {}) {
    await waitAssistantIdle(quietMs, hardMs);
    const text = D.extractAssistantText?.() || '';
    if (text.trim()) {
      saveTextAsFile(text, baseName);
      toast('已保存回复');
      return true;
    } else {
      toast('回复为空或提取失败');
      return false;
    }
  }

  /**
   * 现有：从 IndexedDB 取指定文件并发送（原有功能）
   * @param {string} fileId
   * @param {object} opts - { prompt, deleteAfter, timeout, stableMs }
   */
  async function runSendFromStorage(fileId, opts = {}) {
    const {
      prompt      = undefined,
      deleteAfter = true,
      timeout     = 60000,
      stableMs    = 500
    } = opts;

    if (!ST.restoreAsFile || !UP.pasteFilesToEditor) { toast('storage/uploader 未加载'); return false; }
    if (!D.getComposerScope || !D.waitReadyToSend || !D.pressEnterInEditor) { toast('dom.adapters 未加载或缺少方法'); return false; }

    const file = await ST.restoreAsFile(fileId);
    if (!file) { toast('未在存储中找到文件'); return false; }

    const editor = await getEditorOrWait();
    if (!editor) { toast('找不到输入框'); return false; }

    // 粘贴
    try { UP.pasteFilesToEditor(editor, [file]); toast(`已粘贴：${file.name || '文件'}`); }
    catch { toast('粘贴失败'); return false; }

    // 粘贴后即删（按你的要求）
    if (deleteAfter && ST.deleteFile) { try { await ST.deleteFile(fileId); } catch {} }

    // 等“可发送”
    const scope = D.getComposerScope(editor);
    const ready = await D.waitReadyToSend(scope, { timeout, stableMs });
    if (!ready) { toast('未达到可发送状态'); return false; }

    // 写 prompt
    const text = getPromptFromUI(prompt);
    if (text) { typePromptIntoEditor(editor, text); await sleep(80); }

    // 回车发送
    const sent = D.pressEnterInEditor(editor);
    if (!sent) { toast('回车发送失败'); return false; }

    toast('已触发发送');
    return true;
  }

  /**
   * 新增：从存储取文件 → 发送 → 写入一个字符 → 等结束 → 抓取并保存
   * @param {string} fileId
   * @param {object} opts - 同上 + { replyBaseName='reply', replyQuietMs=500, replyHardMs=4000 }
   */
  async function runSendFromStorageAndSave(fileId, opts = {}) {
    const {
      prompt      = undefined,
      deleteAfter = true,
      timeout     = 60000,
      stableMs    = 500,
      replyBaseName = undefined,      // 默认用文件名（去扩展名）
      replyQuietMs  = 500,
      replyHardMs   = 4000
    } = opts;

    // 先发
    const ok = await runSendFromStorage(fileId, { prompt, deleteAfter, timeout, stableMs });
    if (!ok) return false;

    // “写一个字符”，保证结束后按钮回到 send
    const editor = D.getEditor?.();
    if (editor) nudgeEditorForReply(editor);

    // 等生成结束（按钮回到 send 且可点）
    const scope = D.getComposerScope(editor || null);
    const done = await waitReplyDone(scope, { timeout, stableMs: 400 });
    if (!done) { toast('生成超时'); return false; }

    // 安静期后抓取并保存
    // 用文件名做前缀更直观
    let base = replyBaseName;
    if (!base) {
      try {
        const meta = (await ST.listFiles())?.find(x => x.id === fileId); // 可能已删，兜底
        base = meta?.name ? meta.name.replace(/\.[^.]+$/, '') : 'reply';
      } catch { base = 'reply'; }
    }
    return await captureAndSaveReply({ baseName: base, quietMs: replyQuietMs, hardMs: replyHardMs });
  }

  // 导出
  H.runSendFromStorage = runSendFromStorage;
  H.runSendFromStorageAndSave = runSendFromStorageAndSave;
  H.typePromptIntoEditor = typePromptIntoEditor;
  H.getPromptFromUI = getPromptFromUI;
  H.nudgeEditorForReply = nudgeEditorForReply;
  H.waitReplyDone = waitReplyDone;
  H.waitAssistantIdle = waitAssistantIdle;
  H.captureAndSaveReply = captureAndSaveReply;
  H.saveTextAsFile = saveTextAsFile;

  global.GPTB.uiHelpers = H;
  try { console.log('[mini] chat.ui.helpers loaded (send + capture/save)'); } catch {}
})(typeof window !== 'undefined' ? window : this);
  try { if (typeof unsafeWindow !== 'undefined') unsafeWindow.GPTB = window.GPTB; } catch {}

