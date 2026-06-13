// Stories-specific viewport click handling
import { state, saveSettings } from './config.js';
import { isClickInsideElement } from './utils.js';
import { findNativeMuteButton, isNativeButtonMuted } from './native-button.js';
import { showSpeedMenu } from './speed-menu.js';

export function setupStoryViewportClick(video) {
  const viewport = video.closest('section, ._as3a') || video.parentElement;
  if (!viewport) return;

  if (viewport._hasStoryViewportListener) return;
  viewport._hasStoryViewportListener = true;

  const handler = (e) => {
    const activeVideo = viewport.querySelector('video');
    if (!activeVideo) return;

    if (!isClickInsideElement(e, activeVideo.parentElement || activeVideo)) return;

    const speedBtnEl = e.target.closest('.ig-inline-speed-btn');
    if (speedBtnEl) {
      e.stopPropagation();
      e.preventDefault();
      showSpeedMenu(speedBtnEl, activeVideo);
      return;
    }

    const isControlClick = e.target.closest(
      '.ig-volume-slider-container, .ig-video-scrubber-container, .ig-action-item, input[type="range"]'
    );
    if (isControlClick) {
      e.stopPropagation();
      e.preventDefault();
      return;
    }

    const isHeaderClick = e.target.closest('header, ._ac7v, button, [role="button"]');
    if (isHeaderClick) return;

    e.preventDefault();
    e.stopPropagation();

    if (!state.firstUnmuteTriggered) {
      const nativeBtn = activeVideo._nativeMuteBtn || findNativeMuteButton(activeVideo);
      const iconShowsMuted = nativeBtn ? isNativeButtonMuted(nativeBtn, activeVideo) : false;

      if (iconShowsMuted) {
        state.firstUnmuteTriggered = true;
        state.lastUserInteractionTime = Date.now();
        state.globalMuted = false;
        saveSettings();

        if (nativeBtn) {
          import('./utils.js').then(m => m.safeClick(nativeBtn));
        }
        return;
      } else {
        state.firstUnmuteTriggered = true;
      }
    }

    const playPauseBtn = findNativePlayPauseButton(activeVideo);
    if (playPauseBtn) {
      import('./utils.js').then(m => m.safeClick(playPauseBtn));
    } else {
      if (activeVideo.paused) {
        activeVideo.play().catch(() => { });
      } else {
        activeVideo.pause();
      }
    }
  };

  viewport.addEventListener('click', handler, { capture: true });
}

export function findNativePlayPauseButton(video) {
  const playerContainer = video.closest('section, div[role="dialog"], ._as3a');
  if (!playerContainer) return null;
  const buttons = Array.from(playerContainer.querySelectorAll('button, [role="button"], div[tabindex="0"]'));
  const keywords = ['play', 'pause', 'воспроизвести', 'пауза', 'lecture', 'play/pause'];
  return buttons.find(btn => {
    const label = (btn.getAttribute('aria-label') || btn.getAttribute('title') || '').toLowerCase();
    if (keywords.some(kw => label.includes(kw))) return true;

    const svg = btn.querySelector('svg');
    if (svg) {
      const paths = Array.from(svg.querySelectorAll('path')).map(p => p.getAttribute('d') || '');
      const isPlayOrPause = paths.some(p =>
        p.includes('M6 19h4V5H6v14zm8-14v14h4V5h-4z') ||
        p.includes('M8 5v14l11-7z') ||
        p.includes('M5.5 3') ||
        p.includes('M12 2C6.48 2')
      );
      if (isPlayOrPause) return true;
    }
    return false;
  });
}