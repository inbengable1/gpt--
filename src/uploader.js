/* uploader.js — ChatGPT 批处理 · 文件上传模块 (IIFE)
   暴露：window.GPTBatch.Uploader
*/
(function (global) {
  'use strict';
  const NS = (global.GPTBatch = global.GPTBatch || {});

  /** 等待上传完成的按钮（send按钮可用时） **/
  async function waitUploadReadyByButton(editor, timeout = 60000) {
    const scope = getComposerScope(editor);
    const t0 = Date.now();
    let quietStart = null;
    while (Date.now() - t0 < timeout) {
      if (shouldStop()) return false;
      const btn = querySendStopButtonInScope(scope);
      const ok = btn && buttonMode(btn) === 'send' && buttonEnabled(btn);
      if (ok) {
        if (quietStart == null) quietStart = Date.now();
        if (Date.now() - quietStart >= QUIET_MS) return true;
      } else {
        quietStart = null;
      }
      await sleep(120);
    }
    return false;
  }

  /** 将文件粘贴到编辑器中 **/
  function pasteFilesToEditor(editor, files) {
    const dt = new DataTransfer();
    files.forEach(f => dt.items.add(f));
    const evt = new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: dt });
    Object.defineProperty(evt, 'clipboardData', { value: dt });
    editor.dispatchEvent(evt);
  }

  /** 上传文件并处理上传状态 **/
  async function handleFileUpload(editor, files) {
    // 等待文件上传按钮准备好
    const ready = await waitUploadReadyByButton(editor, UPLOAD_READY_TIMEOUT_MS);
    if (!ready) {
      toast('上传超时，跳过文件上传');
      return false;
    }

    // 粘贴文件到编辑器
    pasteFilesToEditor(editor, files);
    await sleep(ATTACH_POST_READY_MS);
    return true;
  }

  /** 获取文件上传状态 **/
  function getUploadStatus(editor) {
    const scope = getComposerScope(editor);
    const btn = querySendStopButtonInScope(scope);
    return buttonMode(btn) === 'send' && buttonEnabled(btn);
  }

  /** 暴露给外部调用的接口 **/
  NS.Uploader = {
    waitUploadReadyByButton,
    pasteFilesToEditor,
    handleFileUpload,
    getUploadStatus
  };
})(typeof window !== 'undefined' ? window : this);