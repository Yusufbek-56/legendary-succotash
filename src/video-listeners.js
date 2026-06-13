// Video event listeners setup
import { state, hasUserInteracted, saveSettings } from './config.js';
import { hasSpeedButtonInDOM } from './sync.js';
import { syncNativeButtonMuteState } from './native-button.js';
import { syncAllVideos } from './sync.js';
import { enforcePlaybackRate } from './reels-controls.js';

export function setupVideoListeners(video) {
  if (video._hasVolumeChangeListener) return;
  video._hasVolumeChangeListener = true;

  state.activeVideos.add(video);

  const enforceSpeed = () => {
    const speedBtnPresent = hasSpeedButtonInDOM(video);
    const targetSpeed = speedBtnPresent ? state.globalPlaybackSpeed : 1.0;

    const originalSetter = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'playbackRate').set;
    if (originalSetter) {
      originalSetter.call(video, targetSpeed);
    } else {
      video.playbackRate = targetSpeed;
    }

    if (!video._hasDoneSpeedPipelineFlush && !video.paused && video.readyState >= 2) {
      video._hasDoneSpeedPipelineFlush = true;
      const curTime = video.currentTime;
      video.currentTime = curTime > 0 ? curTime : 0.001;
    }
  };

  video.addEventListener('play', enforceSpeed, { passive: true });
  video.addEventListener('playing', enforceSpeed, { passive: true });
  video.addEventListener('loadedmetadata', enforceSpeed, { passive: true });
  video.addEventListener('loadeddata', enforceSpeed, { passive: true });
  video.addEventListener('canplay', enforceSpeed, { passive: true });

  video.addEventListener('volumechange', () => {
    if (video._ignoreVolumechange) return;

    if (video._volumechangeEventTimer) {
      clearTimeout(video._volumechangeEventTimer);
    }

    video._volumechangeEventTimer = setTimeout(() => {
      state.globalSliderValue = Math.sqrt(video.volume);
      state.globalMuted = video.muted || video.volume === 0;
      saveSettings();

      syncAllVideos();
      video._volumechangeEventTimer = null;
    }, 10);
  });

  video.addEventListener('play', () => {
    if (hasUserInteracted()) {
      video._ignoreVolumechange = true;
      const targetVol = state.globalMuted ? 0 : Math.pow(state.globalSliderValue, 2);
      video.volume = targetVol;
      syncNativeButtonMuteState(video);
      setTimeout(() => {
        video._ignoreVolumechange = false;
      }, 10);
    }
  });

  const handleWheel = (e) => {
    if (video.paused) return;
    e.preventDefault();
    e.stopPropagation();

    state.lastUserInteractionTime = Date.now();

    const delta = e.deltaY < 0 ? 0.05 : -0.05;
    state.globalSliderValue = Math.max(0, Math.min(1, state.globalSliderValue + delta));
    state.globalMuted = state.globalSliderValue === 0;

    saveSettings();
    syncAllVideos();
    syncNativeButtonMuteState(video);
  };

  if (video._oldHandleWheel) {
    video.removeEventListener('wheel', video._oldHandleWheel, { capture: true });
  }
  video._oldHandleWheel = handleWheel;
  video.addEventListener('wheel', handleWheel, { passive: false, capture: true });
}