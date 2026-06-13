/* ==========================================
   Instagram Volume Controller - Content Script
   Modular entry point for Chrome Manifest V3
   ========================================== */

(async () => {
  try {
    const isMock = typeof window !== 'undefined' && window.__IS_MOCK_TEST__;
    const src = isMock ? './src/lifecycle.js' : chrome.runtime.getURL('src/lifecycle.js');
    await import(src);
    console.debug('[IG Volume] Extension modules loaded successfully.');
  } catch (err) {
    console.error('[IG Volume] Failed to load extension modules:', err);
  }
})();