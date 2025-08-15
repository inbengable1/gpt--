// ui.panel.js — 面板：选择→存库、列表、粘贴/粘贴并发送
(function (global) {
  'use strict';
  global.GPTB = global.GPTB || {};
  const { PANEL_ID } = GPTB.conf;
  const U  = GPTB.utils;
  const ST = GPTB.storage;

  function bytes(n){
    if (n < 1024) return n + ' B';
    if (n < 1024*1024) return (n/1024).toFixed(1)+' KB';
    return (n/1024/1024).toFixed(1)+' MB';
  }

  async function refreshList() {
    const box = document.getElementById('gptb-mini-list');
    if (!box) return;
    const all = await ST.listFiles();
    box.innerHTML = '';
    if (!all.length) { box.textContent = '（空）'; return; }
    for (const f of all) {
      const row = document.createElement('div');
      row.style.cssText = 'display:grid;grid-template-columns:1fr auto auto;gap:8px;align-items:center;padding:6px 0;border-bottom:1px dashed #333';
      row.innerHTML = `
        <span title="${f.name}">${f.name}</span>
        <span style="opacity:.8">${bytes(f.size)} · ${f.chunks}块</span>
        <span style="display:flex;gap:6px;justify-content:flex-end">
          <button class="gptb-act" data-act="paste" data-id="${f.id}" style="padding:4px 8px;border:1px solid #444;border-radius:6px;background:#1b1b1f;color:#fff;cursor:pointer">粘贴</button>
          <button class="gptb-act" data-act="paste-send" data-id="${f.id}" style="padding:4px 8px;border:none;border-radius:6px;background:#10a37f;color:#fff;cursor:pointer">粘贴并发送</button>
        </span>
      `;
      box.appendChild(row);
    }
  }

  function ensurePanel(){
    if (document.getElementById(PANEL_ID)) return;

    const wrap = document.createElement('div');
    wrap.id = PANEL_ID;
    Object.assign(wrap.style, {
      position:'fixed', right:'16px', bottom:'16px', width:'380px',
      background:'rgba(24,24,28,.96)', color:'#fff', borderRadius:'12px',
      padding:'12px', zIndex:999999, boxShadow:'0 8px 24px rgba(0,0,0,.35)',
      fontSize:'13px', lineHeight:'1.45'
    });
    wrap.innerHTML = `
      <div style="font-weight:600;margin-bottom:8px">Batch Mini · 粘贴/发送</div>
      <div style="display:flex;gap:8px;margin-bottom:8px">
        <button id="gptb-pick"  style="padding:6px 10px;border:none;border-radius:8px;background:#10a37f;color:#fff;cursor:pointer">选择并保存</button>
        <button id="gptb-clear" style="padding:6px 10px;border:1px solid #444;border-radius:8px;background:transparent;color:#fff;cursor:pointer">清空存储</button>
        <button id="gptb-close" style="padding:6px 10px;border:1px solid #444;border-radius:8px;background:transparent;color:#fff;cursor:pointer">关闭</button>
      </div>
      <div style="opacity:.8;margin:4px 0">已保存文件：</div>
      <div id="gptb-mini-list" style="max-height:200px;overflow:auto;border:1px dashed #444;border-radius:8px;padding:6px;background:#0f0f10"></div>
      <div style="opacity:.7;font-size:12px;margin-top:6px">提示：点击“粘贴并发送”会查找发送按钮并尝试提交。</div>
    `;
    document.body.appendChild(wrap);

    // 顶部三个按钮
    wrap.querySelector('#gptb-pick').onclick = async () => {
      const metas = await GPTB.uploader.selectAndSave();
      if (metas.length) await refreshList();
    };
    wrap.querySelector('#gptb-clear').onclick = async () => {
      const all = await ST.listFiles();
      for (const f of all) await ST.deleteFile(f.id);
      U.toast('存储已清空');
      await refreshList();
    };
    wrap.querySelector('#gptb-close').onclick = () => wrap.remove();

    // 列表按钮（事件委托）
    wrap.addEventListener('click', async (ev) => {
      const btn = ev.target.closest('.gptb-act');
      if (!btn) return;
      const id  = btn.getAttribute('data-id');
      const act = btn.getAttribute('data-act');

      // 还原文件
      const file = await GPTB.storage.restoreAsFile(id);
      if (!file) return U.toast('未找到文件');

      // 找编辑器
      const ed = GPTB.dom.getEditor() || await GPTB.dom.waitForSelector('#prompt-textarea');
      if (!ed) return U.toast('找不到编辑器');

      // 粘贴
      GPTB.uploader.pasteFilesToEditor(ed, [file]);
      U.toast('已粘贴到输入框');

      if (act === 'paste-send') {
        // 等待“发送”按钮可用后点击
        const scope = GPTB.dom.getComposerScope(ed);
        const ok = await GPTB.uiHelpers.waitButton(scope, 'send', true, 15000);
        if (!ok) return U.toast('未检测到可用的发送按钮');
        const sent = await GPTB.uiHelpers.trySend(scope);
        U.toast(sent ? '已发送' : '发送失败');
      }
    });

    refreshList();
  }

  // 自启动
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', ensurePanel);
  } else {
    ensurePanel();
  }

  global.GPTB.ui = { ensurePanel, refreshList };
  try { console.log('[mini] ui.panel loaded (+paste/send)'); } catch {}
})(typeof window !== 'undefined' ? window : this);
