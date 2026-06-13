// Main lifecycle: scanner, mutation observer, SPA navigation detection
import { state, hasUserInteracted, saveSettings, isScriptOrphaned } from './config.js';
import { injectCoreStyles } from './styles.js';
import { findCommonAncestor } from './utils.js';
import { isClickInsideElement, safeClick } from './utils.js';
import { findNativeMuteButton, isNativeButtonMuted } from './native-button.js';
import { isMainPlayer, findReelsActionBar, checkIsStory, checkIsReel } from './detection.js';
import { clearOverlayInterference } from './overlay-shield.js';
import { setupVideoListeners } from './video-listeners.js';
import { injectScrubber, updateScrubberPosition } from './scrubber.js';
import { injectExtraControls } from './reels-controls.js';
import { setupStoryViewportClick } from './story-controls.js';
import { injectStorySpeedButton } from './story-speed.js';
import { injectFeedSpeedButton } from './feed-controls.js';
import { hasSpeedButtonInDOM, syncAllVideos } from './sync.js';

injectCoreStyles();

let scanTimeout = null;

export function triggerScan() {
  if (scanTimeout) clearTimeout(scanTimeout);
  scanTimeout = setTimeout(scanAndInject, 30);
}

export function scanAndInject() {
  if (isScriptOrphaned()) {
    if (window.globalScanInterval) clearInterval(window.globalScanInterval);
    if (typeof observer !== 'undefined') observer.disconnect();
    const style = document.getElementById('ig-volume-controller-core-styles');
    if (style) style.remove();
    return;
  }

  if (state.lastGlobalPath !== window.location.pathname) {
    state.lastGlobalPath = window.location.pathname;
  }

  document.querySelectorAll('video').forEach(video => {
    if (!isMainPlayer(video)) {
      return;
    }

    clearOverlayInterference(video);

    if (!video._hasPlayScanListener) {
      video._hasPlayScanListener = true;
      video.addEventListener('play', triggerScan);
      video.addEventListener('playing', triggerScan);
      video.addEventListener('timeupdate', triggerScan, { once: true });
    }

    if (checkIsStory(video)) {
      setupStoryViewportClick(video);
    }

    if (!video.isConnected || (video.offsetWidth === 0 && video.offsetHeight === 0)) {
      return;
    }

    const pathChanged = video._lastPath !== window.location.pathname;
    const srcChanged = video._lastSrc !== video.currentSrc;

    if (srcChanged || pathChanged) {
      video._lastSrc = video.currentSrc;
      video._lastPath = window.location.pathname;
      video._autoSkipTriggered = false;
      video._hasDoneSpeedPipelineFlush = false;
      video._hasStoryViewportListener = false;
      video._lastScrubberRect = null;

      if (video._oldHandleWheel) {
        video.removeEventListener('wheel', video._oldHandleWheel, { capture: true });
        video._oldHandleWheel = null;
      }

      if (video._playbackRateInterceptorsApplied) {
        const proto = HTMLMediaElement.prototype;
        const desc = Object.getOwnPropertyDescriptor(proto, 'playbackRate');
        if (desc) {
          Object.defineProperty(video, 'playbackRate', desc);
        } else {
          delete video.playbackRate;
        }
        video._playbackRateInterceptorsApplied = false;
      }

      const originalSetter = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'playbackRate').set;
      if (originalSetter) {
        originalSetter.call(video, 1.0);
      } else {
        video.playbackRate = 1.0;
      }

      if (video._scrubberContainer) {
        video._scrubberContainer.remove();
        video._scrubberContainer = null;
      }
      if (video._sliderContainer) {
        video._sliderContainer.remove();
        video._sliderContainer = null;
      }
      if (video._speedActionItem) {
        video._speedActionItem.remove();
        video._speedActionItem = null;
      }
      if (video._autoskipActionItem) {
        video._autoskipActionItem.remove();
        video._autoskipActionItem = null;
      }
      if (video._floatingControlsContainer) {
        video._floatingControlsContainer.remove();
        video._floatingControlsContainer = null;
      }
      if (video._storySpeedBtn) {
        video._storySpeedBtn.remove();
        video._storySpeedBtn = null;
      }
      if (video._feedSpeedBtn) {
        video._feedSpeedBtn.remove();
        video._feedSpeedBtn = null;
      }

      video._hasScrubber = false;
      video._hasVolumeSlider = false;
      video._hasExtraControls = false;
      video._hasStorySpeedBtn = false;
      video._hasFeedSpeedBtn = false;

      if (video._oldHandleVideoEnded) {
        video.removeEventListener('ended', video._oldHandleVideoEnded);
        video._oldHandleVideoEnded = null;
      }
      if (video._oldHandleTimeUpdateForSkip) {
        video.removeEventListener('timeupdate', video._oldHandleTimeUpdateForSkip);
        video._oldHandleTimeUpdateForSkip = null;
      }
      if (video._oldHandlePlayRate) {
        video.removeEventListener('play', video._oldHandlePlayRate);
        video.removeEventListener('playing', video._oldHandlePlayRate);
        video._oldHandlePlayRate = null;
      }
      if (video._oldRateChangeHandler) {
        video.removeEventListener('ratechange', video._oldRateChangeHandler);
        video._oldRateChangeHandler = null;
      }

      if (video._nativeMuteBtn) {
        video._nativeMuteBtn = null;
      }
      if (video._cachedActionBar) {
        video._cachedActionBar = null;
      }
    }

    setupVideoListeners(video);

    const clickTarget = video.parentElement || video;

    if (clickTarget && !clickTarget._hasFirstClickUnmuteListener) {
      clickTarget._hasFirstClickUnmuteListener = true;
      clickTarget.addEventListener('click', (e) => {
        const nativeBtn = video._nativeMuteBtn || findNativeMuteButton(video);
        const actionBar = video._cachedActionBar || findReelsActionBar(video);

        // Проверяем, совершен ли клик по элементам управления звуком или панели скорости
        const isControlClick =
          (nativeBtn && (nativeBtn === e.target || nativeBtn.contains(e.target))) ||
          (actionBar && actionBar.contains(e.target)) ||
          e.target.closest('.ig-volume-slider-container, .ig-video-scrubber-container, .ig-action-item, .ig-inline-speed-btn, .ig-speed-menu, .ig-reels-speed-menu, input[type="range"]');

        if (isControlClick) return;

        if (!state.firstUnmuteTriggered) {
          const iconShowsMuted = nativeBtn ? isNativeButtonMuted(nativeBtn, video) : false;

          if (iconShowsMuted) {
            e.preventDefault();
            e.stopPropagation(); // Блокируем нативную паузу для первого разблокирования звука

            state.firstUnmuteTriggered = true;
            state.lastUserInteractionTime = Date.now();
            state.globalMuted = false;
            saveSettings();

            if (nativeBtn) {
              safeClick(nativeBtn); // Активируем звук
            }
          } else {
            state.firstUnmuteTriggered = true;
          }
        }
      }, { capture: true });
    }

    let currentBtn = video._nativeMuteBtn;
    if (!currentBtn || !currentBtn.isConnected) {
      currentBtn = findNativeMuteButton(video);
      if (currentBtn) {
        video._nativeMuteBtn = currentBtn;
      }
    }

    if (currentBtn) {
      if (currentBtn._oldClickHandler) {
        currentBtn.removeEventListener('click', currentBtn._oldClickHandler, { capture: true });
      }

      const clickHandler = () => {
        if (currentBtn._ignoreClick) return;
        state.lastUserInteractionTime = Date.now();

        video._ignoreMuteBtnSync = true;
        setTimeout(() => {
          video._ignoreMuteBtnSync = false;
        }, 10);

        const iconShowsMuted = isNativeButtonMuted(currentBtn, video);
        state.globalMuted = !iconShowsMuted;

        saveSettings();
        syncAllVideos();
      };

      currentBtn._oldClickHandler = clickHandler;
      currentBtn.addEventListener('click', clickHandler, { capture: true, passive: true });
    }

    const expectedParent = (currentBtn ? findCommonAncestor(video, currentBtn) : null) || video.parentElement;

    if (!video._hasScrubber || !video._scrubberContainer || !video._scrubberContainer.isConnected || video._scrubberContainer.parentElement !== expectedParent) {
      if (video._scrubberContainer) {
        video._scrubberContainer.remove();
        video._scrubberContainer = null;
      }
      video._hasScrubber = false;
      injectScrubber(video);
    } else {
      updateScrubberPosition(video, video._scrubberContainer);

      const parent = video._scrubberContainer.parentElement;
      if (parent && parent.lastElementChild !== video._scrubberContainer) {
        parent.appendChild(video._scrubberContainer);
      }
    }



    let actionBar = video._cachedActionBar;
    if (!actionBar || !actionBar.isConnected) {
      actionBar = findReelsActionBar(video);
      if (actionBar) {
        video._cachedActionBar = actionBar;
      }
    }

    let hasExtraControlsConnected = video._hasExtraControls &&
      video._speedActionItem && video._speedActionItem.isConnected &&
      video._autoskipActionItem && video._autoskipActionItem.isConnected &&
      (!actionBar || (video._speedActionItem.parentElement === actionBar && video._autoskipActionItem.parentElement === actionBar));

    if (!hasExtraControlsConnected) {
      if (video._speedActionItem) video._speedActionItem.remove();
      if (video._autoskipActionItem) video._autoskipActionItem.remove();
      if (video._floatingControlsContainer) video._floatingControlsContainer.remove();
      video._hasExtraControls = false;
      injectExtraControls(video, actionBar);
    }

    if (checkIsStory(video)) {
      if (video._storySpeedBtn && !video._storySpeedBtn.isConnected) {
        video._storySpeedBtn = null;
        video._hasStorySpeedBtn = false;
      }
      if (!video._hasStorySpeedBtn) {
        injectStorySpeedButton(video);
      }
    }

    const isFeedPost = !checkIsReel(video) && !checkIsStory(video);
    if (isFeedPost) {
      if (video._feedSpeedBtn && !video._feedSpeedBtn.isConnected) {
        video._feedSpeedBtn = null;
        video._hasFeedSpeedBtn = false;
      }
      if (!video._hasFeedSpeedBtn) {
        injectFeedSpeedButton(video, currentBtn);
      } else if (video._updateFeedSpeedPos) {
        video._updateFeedSpeedPos();
      }
    }

    const isReel = checkIsReel(video);
    if (!isReel && !hasSpeedButtonInDOM(video)) {
      if (video.hasOwnProperty('playbackRate') || 'playbackRate' in video) {
        delete video.playbackRate;
      }
      video._playbackRateInterceptorsApplied = false;

      const originalSetter = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'playbackRate').set;
      if (originalSetter) {
        originalSetter.call(video, 1.0);
      } else {
        video.playbackRate = 1.0;
      }
    }
  });
}

const observer = new MutationObserver((mutations) => {
  let shouldScan = false;

  for (const mutation of mutations) {
    for (const node of mutation.addedNodes) {
      if (node.nodeType === Node.ELEMENT_NODE) {
        const tagName = node.tagName;
        if (tagName === 'VIDEO' || tagName === 'BUTTON' || node.querySelector('video, button, [role="button"]')) {
          shouldScan = true;
          break;
        }
      }
    }
    if (shouldScan) break;
  }

  if (shouldScan) {
    triggerScan();
  }
});
observer.observe(document.body, { childList: true, subtree: true });

const originalPushState = history.pushState;
history.pushState = function (...args) {
  originalPushState.apply(this, args);
  triggerScan();
};
const originalReplaceState = history.replaceState;
history.replaceState = function (...args) {
  originalReplaceState.apply(this, args);
  triggerScan();
};

window.addEventListener('popstate', triggerScan, { passive: true });

scanAndInject();
window.globalScanInterval = setInterval(triggerScan, 300);

document.addEventListener('keydown', (e) => {
  const key = e.key.toLowerCase();
  if (['m', 'arrowup', 'arrowdown'].includes(key)) {
    state.lastUserInteractionTime = Date.now();
    state.firstUnmuteTriggered = true;
  }
}, { capture: true, passive: true });