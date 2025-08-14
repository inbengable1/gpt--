/* utils.js — ChatGPT 批处理 · 通用工具模块 (IIFE)
   暴露：window.GPTBatch.Utils
*/
(function (global) {
  'use strict';
  const NS = (global.GPTBatch = global.GPTBatch || {});
  const Config = NS.Config || {
    USE_TEMPORARY_CHAT: true,
    get BASE_URL() { return location.origin; }
  };

  /** 基础工具 **/
  function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
  }
  function nowStamp() {
    return new Date().toISOString().replace(/[:.]/g, '-');
  }
  function getParam(name) {
    const m = new URLSearchParams(location.search).get(name);
    return m == null ? null : String(m);
  }
  function makeFreshId() {
    // 优先用高质量随机，退化到时间戳
    if (global.crypto && crypto.randomUUID) return crypto.randomUUID();
    return String(Date.now());
  }
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, m => ({
      '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
    }[m]));
  }

  /** URL 构造：根据 Config 构建“新聊天”地址（支持临时聊天） **/
  function buildNewChatURL(freshId) {
    const u = new URL(Config.BASE_URL + '/');
    if (Config.USE_TEMPORARY_CHAT) u.searchParams.set('temporary-chat', 'true');
    if (freshId) u.searchParams.set('fresh', freshId);
    return u.toString();
  }

  /** 下载纯文本为本地文件 **/
  function saveTxt(text, base = 'reply') {
    try {
      const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${base}-${nowStamp()}.txt`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error('saveTxt failed:', e);
    }
  }

  /** 新开标签页（优先 GM_openInTab，回退 window.open / a.click） **/
  function openNewTab(url) {
    try {
      if (typeof GM_openInTab === 'function') {
        GM_openInTab(url, { active: true, setParent: true, insert: true });
        return true;
      }
    } catch (e) {
      // ignore and fallback
    }
    try {
      const w = window.open(url, '_blank', 'noopener');
      if (w) return true;
    } catch (e) {
      // ignore and fallback
    }
    try {
      const a = document.createElement('a');
      a.href = url; a.target = '_blank'; a.rel = 'noopener';
      document.body.appendChild(a); a.click(); a.remove();
      return true;
    } catch (e) {
      console.error('openNewTab fallback failed:', e);
      return false;
    }
  }

  /** 关闭当前页的多重兜底：window.close → _self → about:blank **/
  function tryCloseSelf(delayMs = 150) {
    setTimeout(() => {
      try { window.close(); } catch {}
      try { window.opener = null; window.open('', '_self'); window.close(); } catch {}
      try { location.replace('about:blank'); } catch {}
    }, delayMs);
  }

  /** 轻量 Toast **/
  function toast(msg, ms = 2200) {
    try {
      const d = document.createElement('div');
      d.textContent = msg;
      Object.assign(d.style, {
        position: 'fixed', right: '16px', bottom: '16px', zIndex: 999999,
        padding: '8px 12px', background: 'rgba(0,0,0,.85)', color: '#fff',
        borderRadius: '8px', fontSize: '12px', pointerEvents: 'none'
      });
      document.body.appendChild(d);
      setTimeout(() => d.remove(), ms);
    } catch (e) {
      console.log('[Toast]', msg);
    }
  }

  // 导出到命名空间
  NS.Utils = {
    sleep,
    nowStamp,
    getParam,
    makeFreshId,
    escapeHtml,
    buildNewChatURL,
    saveTxt,
    openNewTab,
    tryCloseSelf,
    toast,
  };
})(typeof window !== 'undefined' ? window : this);