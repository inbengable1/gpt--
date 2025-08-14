// ui.panel.js — 仅负责把面板插到页面
(function (global) {
  'use strict';
  global.GPTB = global.GPTB || {};
  const { PANEL_ID } = GPTB.conf;
  const { toast } = GPTB.utils;

  function ensurePanel(){
    if (document.getElementById(PANEL_ID)) return;

    const wrap = document.createElement('div');
    wrap.id = PANEL_ID;
    Object.assign(wrap.style, {
      position:'fixed', right:'16px', bottom:'16px', width:'320px',
      background:'rgba(24,24,28,.96)', color:'#fff', borderRadius:'12px',
      padding:'12px', zIndex:999999, boxShadow:'0 8px 24px rgba(0,0,0,.35)',
      fontSize:'13px', lineHeight:'1.45'
    });
    wrap.innerHTML = `
      <div style="font-weight:600;margin-bottom:8px">Batch Mini · 仅UI</div>
      <div style="margin-bottom:8px">
        <textarea id="gptb-mini-prompt" rows="4" placeholder="这里先啥也不做" 
          style="width:100%;resize:vertical;border-radius:8px;padding:8px;border:1px solid #444;background:#111;color:#fff;"></textarea>
      </div>
      <div style="display:flex;gap:8px;justify-content:flex-end">
        <button id="gptb-mini-test"  style="padding:6px 10px;border:none;border-radius:8px;background:#10a37f;color:#fff;cursor:pointer">测试</button>
        <button id="gptb-mini-close" style="padding:6px 10px;border:1px solid #444;border-radius:8px;background:transparent;color:#fff;cursor:pointer">关闭</button>
      </div>
      <div style="opacity:.7;font-size:12px;margin-top:6px">当前仅显示UI，不会上传/发送</div>
    `;
    document.body.appendChild(wrap);

    // 事件（先只提示）
    wrap.querySelector('#gptb-mini-test').onclick = () => {
      const v = (document.getElementById('gptb-mini-prompt') || {}).value || '';
      toast(v ? `输入了 ${v.length} 个字符` : '还没输入内容');
      console.log('[mini] Test clicked. value=', v);
    };
    wrap.querySelector('#gptb-mini-close').onclick = () => wrap.remove();
  }

  GPTB.ui = { ensurePanel };
  try { console.log('[mini] ui.panel loaded'); } catch {}
})(typeof window !== 'undefined' ? window : this);
