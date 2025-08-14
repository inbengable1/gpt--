// ui.panel.js — 仅UI：选择→存库、列表、清空
(function (global) {
  'use strict';
  global.GPTB = global.GPTB || {};
  const { PANEL_ID } = GPTB.conf;
  const U = GPTB.utils;

  function bytes(n){
    if (n < 1024) return n + ' B';
    if (n < 1024*1024) return (n/1024).toFixed(1)+' KB';
    return (n/1024/1024).toFixed(1)+' MB';
  }

  async function refreshList() {
    const box = document.getElementById('gptb-mini-list');
    if (!box) return;
    const all = await GPTB.storage.listFiles();
    box.innerHTML = '';
    if (!all.length) { box.textContent = '（空）'; return; }
    for (const f of all) {
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;justify-content:space-between;gap:8px;padding:4px 0;border-bottom:1px dashed #333';
      row.innerHTML = `
        <span title="${f.name}">${f.name}</span>
        <span style="opacity:.8">${bytes(f.size)} · ${f.chunks}块</span>
      `;
      box.appendChild(row);
    }
  }

  function ensurePanel(){
    if (document.getElementById(PANEL_ID)) return;

    const wrap = document.createElement('div');
    wrap.id = PANEL_ID;
    Object.assign(wrap.style, {
      position:'fixed', right:'16px', bottom:'16px', width:'360px',
      background:'rgba(24,24,28,.96)', color:'#fff', borderRadius:'12px',
      padding:'12px', zIndex:999999, boxShadow:'0 8px 24px rgba(0,0,0,.35)',
      fontSize:'13px', lineHeight:'1.45'
    });
    wrap.innerHTML = `
      <div style="font-weight:600;margin-bottom:8px">Batch Mini · 存储面板（IndexedDB）</div>
      <div style="display:flex;gap:8px;margin-bottom:8px">
        <button id="gptb-pick"  style="padding:6px 10px;border:none;border-radius:8px;background:#10a37f;color:#fff;cursor:pointer">选择并保存</button>
        <button id="gptb-clear" style="padding:6px 10px;border:1px solid #444;border-radius:8px;background:transparent;color:#fff;cursor:pointer">清空存储</button>
        <button id="gptb-close" style="padding:6px 10px;border:1px solid #444;border-radius:8px;background:transparent;color:#fff;cursor:pointer">关闭</button>
      </div>
      <div style="opacity:.8;margin:4px 0">已保存文件：</div>
      <div id="gptb-mini-list" style="max-height:160px;overflow:auto;border:1px dashed #444;border-radius:8px;padding:6px;background:#0f0f10"></div>
      <div style="opacity:.7;font-size:12px;margin-top:6px">仅本地存储：大文件分片写入，不占用 GM_*；刷新页面仍保留。</div>
    `;
    document.body.appendChild(wrap);

    wrap.querySelector('#gptb-pick').onclick = async () => {
      const metas = await GPTB.uploader.selectAndSave();
      if (metas.length) await refreshList();
    };
    wrap.querySelector('#gptb-clear').onclick = async () => {
      // 逐个删，避免锁表
      const all = await GPTB.storage.listFiles();
      for (const f of all) await GPTB.storage.deleteFile(f.id);
      U.toast('存储已清空');
      await refreshList();
    };
    wrap.querySelector('#gptb-close').onclick = () => wrap.remove();

    refreshList();
  }

  // 自启动
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', ensurePanel);
  } else {
    ensurePanel();
  }

  global.GPTB.ui = { ensurePanel, refreshList };
  try { console.log('[mini] ui.panel loaded'); } catch {}
})(typeof window !== 'undefined' ? window : this);
