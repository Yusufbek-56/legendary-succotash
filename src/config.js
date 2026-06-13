// Global state and user preferences
export const state = {
  globalSliderValue: 0.8,
  globalMuted: false,
  globalPlaybackSpeed: 1.0,
  globalAutoSkip: false,
  firstUnmuteTriggered: false,
  activeVideos: new Set(),
  lastUserInteractionTime: 0,
  lastAutoSkipTime: 0,
  lastGlobalPath: window.location.pathname
};

export function hasUserInteracted() {
  return state.lastUserInteractionTime > 0;
}

export function loadSettings() {
  try {
    if (typeof chrome !== 'undefined' && chrome.runtime?.id && chrome.storage?.local) {
      chrome.storage.local.get(['igGlobalVolume', 'igGlobalMuted', 'igPlaybackSpeed', 'igAutoSkip'], (data) => {
        if (isScriptOrphaned()) return;
        if (data.igGlobalVolume !== undefined) state.globalSliderValue = parseFloat(data.igGlobalVolume);
        if (data.igGlobalMuted !== undefined) state.globalMuted = !!data.igGlobalMuted;
        if (data.igPlaybackSpeed !== undefined) state.globalPlaybackSpeed = parseFloat(data.igPlaybackSpeed);
        if (data.igAutoSkip !== undefined) state.globalAutoSkip = !!data.igAutoSkip;
        import('./sync.js').then(m => m.syncAllVideos());
      });
    }
  } catch (e) {
    console.debug("[IG Volume] Storage read deferred due to context invalidation.", e);
  }
}

export function saveSettings() {
  try {
    if (typeof chrome !== 'undefined' && chrome.runtime?.id && chrome.storage?.local) {
      chrome.storage.local.set({
        igGlobalVolume: state.globalSliderValue,
        igGlobalMuted: state.globalMuted,
        igPlaybackSpeed: state.globalPlaybackSpeed,
        igAutoSkip: state.globalAutoSkip
      });
    }
  } catch (e) {
    console.debug("[IG Volume] Storage write deferred due to context invalidation.", e);
  }
}

export function isScriptOrphaned() {
  if (window.__IS_MOCK_TEST__) return false;
  try {
    return typeof chrome === 'undefined' || !chrome.runtime?.id;
  } catch (e) {
    return true;
  }
}

loadSettings();