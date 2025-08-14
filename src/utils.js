// utils.js — 只放最小工具（无顶层 await）
(function (global) {
  'use strict';
  global.GPTB = global.GPTB || {};
  const U = GPTB.utils = {
    sleep(ms){ return new Promise(r => setTimeout(r, ms)); },
    toast(msg, ms=1800){
      try {
        const d = document.createElement('div');
        d.textContent = msg;
        Object.assign(d.style, {
          position:'fixed', right:'16px', bottom:'16px', zIndex:999999,
          padding:'8px 12px', background:'rgba(0,0,0,.85)', color:'#fff',
          borderRadius:'8px', fontSize:'12px'
        });
        document.body.appendChild(d);
        setTimeout(() => d.remove(), ms);
      } catch(e){ console.log('[mini]', msg); }
    }
  };
  // 便于控制台快速验证
  try { console.log('[mini] utils loaded'); } catch {}
})(typeof window !== 'undefined' ? window : this);
