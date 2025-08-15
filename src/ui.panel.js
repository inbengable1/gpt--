// ui.panel.js — 存储列表 + 一个按钮触发发送逻辑（runSendFromStorage）
(function (global) {
  'use strict';
  global.GPTB = global.GPTB || {};
  const U  = global.GPTB.utils;
  const ST = global.GPTB.storage;
  const H  = global.GPTB.uiHelpers;

  const PANEL_ID = (global.GPTB.conf && global.GPTB.conf.PANEL_ID) || 'gptb-mini-panel';
  const toast = (msg)=> (U?.toast ? U.toast(msg) : console.log('[gptb]', msg));

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
      const row = document.createElement('label');
      row.style.cssText = 'display:grid;grid-template-columns:auto 1fr auto;gap:8px;align-items:center;padding:6px 0;border-bottom:1px dashed #333;cursor:pointer';
      row.innerHTML = `
        <input type="radio" name="gptb-file" value="${f.id}" />
        <span title="${f.name}">${f.name}</span>
        <span style="opacity:.8">${bytes(f.size)} · ${f.chunks}块</span>
      `;
      box.appendChild(row);
    }
  }

  function getSelectedId() {
    const el = document.querySelector('input[name="gptb-file"]:checked');
    return el ? el.value : null;
  }

  function ensurePanel(){
    if (document.getElementById(PANEL_ID)) return;

    const wrap = document.createElement('div');
    wrap.id = PANEL_ID;
    Object.assign(wrap.style, {
      position:'fixed', right:'16px', bottom:'16px', width:'420px',
      background:'rgba(24,24,28,.96)', color:'#fff', borderRadius:'12px',
      padding:'12px', zIndex:999999, boxShadow:'0 8px 24px rgba(0,0,0,.35)',
      fontSize:'13px', lineHeight:'1.45'
    });
    wrap.innerHTML = `
      <div style="font-weight:600;margin-bottom:8px">Batch Mini · 一键发送</div>

      <div style="margin-bottom:8px">
        <textarea id="gptb-mini-prompt" rows="3" placeholder="可选提示词（发送前自动填入）"
          style="width:100%;resize:vertical;border-radius:8px;padding:8px;border:1px solid #444;background:#111;color:#fff;"></textarea>
      </div>

      <div style="display:flex;gap:8px;margin-bottom:8px">
        <button id="gptb-pick"   style="padding:6px 10px;border:none;border-radius:8px;background:#10a37f;color:#fff;cursor:pointer">选择并保存</button>
        <button id="gptb-send"   style="padding:6px 10px;border:none;border-radius:8px;background:#4c82ff;color:#fff;cursor:pointer">发送选中</button>
        <button id="gptb-clear"  style="padding:6px 10px;border:1px solid #444;border-radius:8px;background:transparent;color:#fff;cursor:pointer">清空存储</button>
        <button id="gptb-close"  style="padding:6px 10px;border:1px solid #444;border-radius:8px;background:transparent;color:#fff;cursor:pointer;margin-left:auto">关闭</button>
      </div>

      <div style="opacity:.8;margin:4px 0">已保存文件（单选其一）：</div>
      <div id="gptb-mini-list" style="max-height:220px;overflow:auto;border:1px dashed #444;border-radius:8px;padding:6px;background:#0f0f10"></div>

      <div style="opacity:.7;font-size:12px;margin-top:6px">
        说明：点击“发送选中”将从存储取文件 → 粘贴到输入框 → 等待可发送 → 填入上方 Prompt → 回车提交（并自动从存储中删除该文件）。
      </div>
    `;
    document.body.appendChild(wrap);

    // 按钮：选择并保存文件
    wrap.querySelector('#gptb-pick').onclick = async () => {
      const metas = await GPTB.uploader.selectAndSave();
      if (metas.length) await refreshList();
    };

    // 按钮：发送选中的文件
    wrap.querySelector('#gptb-send').onclick = async (ev) => {
      const btn = ev.currentTarget;
      const id = getSelectedId();
      if (!id) return toast('请先在列表中选择一个文件');

      btn.disabled = true;
      btn.textContent = '发送中…';
      try {
        const ok = await H.runSendFromStorage(id, {
          deleteAfter: true,       // 粘贴成功后即删除
          timeout: 60000,
          stableMs: 500
          // prompt 不传则会自动从 #gptb-mini-prompt 取
        });
        if (ok) toast('已触发发送');
        else    toast('发送失败或条件未满足');
      } finally {
        btn.disabled = false;
        btn.textContent = '发送选中';
        await refreshList();       // 刷新列表（已删除则消失）
      }
    };

    // 按钮：清空存储
    wrap.querySelector('#gptb-clear').onclick = async () => {
      const all = await ST.listFiles();
      for (const f of all) await ST.deleteFile(f.id);
      toast('存储已清空');
      await refreshList();
    };

    // 关闭
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
  try { console.log('[mini] ui.panel loaded (one-button send)'); } catch {}
})(typeof window !== 'undefined' ? window : this);
