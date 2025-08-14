/* config.js — ChatGPT 批处理 · 配置模块 (IIFE)
   暴露：window.GPTBatch.Config
*/
(function (global) {
  'use strict';

  // 统一命名空间
  const NS = (global.GPTBatch = global.GPTBatch || {});

  // —— 站点/选择器（按需改） —— //
  // BASE_URL 用 getter：在不同域名下自动取当前 origin
  const Config = {
    // 是否开启“临时聊天”
    USE_TEMPORARY_CHAT: true,

    // 编辑器选择器（ChatGPT 页面输入区）
    EDITOR_SEL: '#prompt-textarea, [contenteditable="true"].ProseMirror',

    // 站点基址（根据当前页面自动判定）
    get BASE_URL() {
      return location.origin.includes('chat.openai.com')
        ? 'https://chat.openai.com'
        : 'https://chatgpt.com';
    },

    // —— 时序/重试（可按需调整） —— //
    PRE_PASTE_DELAY_MS: 2000,       // 粘贴文件前延迟
    QUIET_MS: 1500,                 // 输出安静期
    UPLOAD_READY_TIMEOUT_MS: 60000, // 等 send 可点（上传完成）
    SEND_ACCEPT_TIMEOUT_MS: 3000,   // 点击后等 stop
    REPLY_DONE_TIMEOUT_MS: 60000,   // 等 stop→send
    ATTACH_POST_READY_MS: 300,      // 上传完成后的小缓冲
    PROMPT_DELAY_MS: 400,           // 填 Prompt 到发送
    SEND_RETRY_MAX: 2,              // 发送失败重试次数（不含首次）

    // —— KV 键名（升级到 v2，避免读到旧 dataURL 队列） —— //
    KEYS: {
      STATE:  'gpt_batch_queue_v2',       // 队列状态（仅存元数据/索引）
      ERR:    'gpt_batch_errors_v2',      // 错误列表
      STOP:   'gpt_batch_stop_v2',        // 紧急停止
      ACTIVE: 'gpt_batch_active_id_v2',   // 当前激活“运行ID”
    }
  };

  NS.Config = Config;
})(typeof window !== 'undefined' ? window : this);