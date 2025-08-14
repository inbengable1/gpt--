// ==UserScript==
// @name         ChatGPT AutoSend Modular (Thin Entry)
// @namespace    https://github.com/yourname/yourrepo
// @version      0.1.0
// @description  A thin entry script that stitches together modular sources for the ChatGPT bulk upload script.
// @author       you
// @match        https://chat.openai.com/*
// @match        https://chatgpt.com/*
// @run-at       document-end
//
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_addStyle
// @grant        GM_registerMenuCommand
// @grant        GM_xmlhttpRequest
//
// @require      https://raw.githubusercontent.com/inbengable1/gpt--/main/src/conf.js
// @require      https://raw.githubusercontent.com/inbengable1/gpt--/main/src/utils.js
// @require      https://raw.githubusercontent.com/inbengable1/gpt--/main/src/dom.adapters.js
// @require      https://raw.githubusercontent.com/inbengable1/gpt--/main/src/storage.idb.js
// @require      https://raw.githubusercontent.com/inbengable1/gpt--/main/src/ui.panel.js
// @require      https://raw.githubusercontent.com/inbengable1/gpt--/main/src/uploader.js
// @require      https://raw.githubusercontent.com/inbengable1/gpt--/main/src/control.runner.js
// ==/UserScript==

/*
 * This entry script acts as the glue for your modular ChatGPT batch uploader.  Each of the
 * `@require` directives above points to a standalone module hosted in your GitHub repository.
 * When Tampermonkey loads this userscript, it will fetch and execute the modules in the order
 * they appear here.  Most modules are written as Immediately Invoked Function Expressions (IIFEs)
 * that register functionality on a shared `window.GPTBatch` namespace and handle their own
 * initialization.  As a result, there's nothing more for us to do here; the act of loading the
 * modules kicks off the batch panel UI and the background runner logic automatically.
 */

(() => {
  // The modules will attach their APIs to the global GPTBatch namespace and begin running
  // immediately.  No additional bootstrap logic is necessary in this stub.
  if (typeof window.GPTBatch !== 'undefined') {
    // Optionally expose the namespace globally for debugging convenience
    console.debug('GPTBatch modules loaded:', window.GPTBatch);
  }
})();
