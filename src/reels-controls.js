// Reels sidebar controls (speed + autoskip)
import { state, saveSettings } from './config.js';
import { findReelsActionBar } from './detection.js';
import { syncAllVideos, hasSpeedButtonInDOM, getNeedleRotationForSpeed } from './sync.js';
import { restorePlayerFocus } from './utils.js';

export function enforcePlaybackRate(video) {
  if (video._playbackRateInterceptorsApplied) return;
  video._playbackRateInterceptorsApplied = true;

  const descriptor = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'playbackRate');
  if (descriptor && descriptor.set) {
    const originalGetter = descriptor.get;
    const originalSetter = descriptor.set;

    Object.defineProperty(video, 'playbackRate', {
      configurable: true,
      get() {
        return originalGetter.call(this);
      },
      set(val) {
        const speedBtnPresent = hasSpeedButtonInDOM(this);
        if (speedBtnPresent) {
          originalSetter.call(this, state.globalPlaybackSpeed);
        } else {
          originalSetter.call(this, val);
        }
      }
    });

    const speedBtnPresent = hasSpeedButtonInDOM(video);
    originalSetter.call(video, speedBtnPresent ? state.globalPlaybackSpeed : 1.0);
  }
}

export function injectExtraControls(video, cachedActionBar) {
  const isReel = checkIsReel(video);

  if (!isReel) {
    if (!hasSpeedButtonInDOM(video) && video.playbackRate !== 1.0) {
      video.playbackRate = 1.0;
    }
    return;
  }

  if (video._hasExtraControls) return;
  video._hasExtraControls = true;

  import('./config.js').then(m => m.state.activeVideos.add(video));
  enforcePlaybackRate(video);

  const actionBar = cachedActionBar || findReelsActionBar(video);

  const speedItem = document.createElement('div');
  speedItem.className = 'ig-action-item ig-speed-item';

  const initialRotation = getNeedleRotationForSpeed(state.globalPlaybackSpeed);

  speedItem.innerHTML = `
    <div class="ig-control-btn ig-speed-btn" title="Speed">
      <svg class="ig-speed-svg" viewBox="0 0 24 24">
        <path d="M 4 15 A 8 8 0 0 1 20 15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
        <path d="M 6 13 A 6 6 0 0 1 18 13" fill="none" stroke="currentColor" stroke-width="1" stroke-dasharray="2,2" opacity="0.6" />
        <line x1="12" y1="7" x2="12" y2="8" stroke="currentColor" stroke-width="1.5"/>
        <line x1="5" y1="12" x2="6.5" y2="12.5" stroke="currentColor" stroke-width="1.5"/>
        <line x1="19" y1="12" x2="17.5" y2="12.5" stroke="currentColor" stroke-width="1.5"/>
        <circle cx="12" cy="15" r="2.5" fill="currentColor" />
        <line class="ig-speed-needle" x1="12" y1="15" x2="12" y2="9" stroke="currentColor" stroke-width="2" stroke-linecap="round" style="transform: rotate(${initialRotation}deg);" />
      </svg>
      <div class="ig-reels-speed-menu">
        <div class="ig-reels-speed-menu-item ${Math.abs(state.globalPlaybackSpeed - 0.25) < 0.01 ? 'active' : ''}" data-speed="0.25">0.25x</div>
        <div class="ig-reels-speed-menu-item ${Math.abs(state.globalPlaybackSpeed - 0.5) < 0.01 ? 'active' : ''}" data-speed="0.5">0.5x</div>
        <div class="ig-reels-speed-menu-item ${Math.abs(state.globalPlaybackSpeed - 0.75) < 0.01 ? 'active' : ''}" data-speed="0.75">0.75x</div>
        <div class="ig-reels-speed-menu-item ${Math.abs(state.globalPlaybackSpeed - 1.0) < 0.01 ? 'active' : ''}" data-speed="1">1x</div>
        <div class="ig-reels-speed-menu-item ${Math.abs(state.globalPlaybackSpeed - 1.25) < 0.01 ? 'active' : ''}" data-speed="1.25">1.25x</div>
        <div class="ig-reels-speed-menu-item ${Math.abs(state.globalPlaybackSpeed - 1.5) < 0.01 ? 'active' : ''}" data-speed="1.5">1.5x</div>
        <div class="ig-reels-speed-menu-item ${Math.abs(state.globalPlaybackSpeed - 1.75) < 0.01 ? 'active' : ''}" data-speed="1.75">1.75x</div>
        <div class="ig-reels-speed-menu-item ${Math.abs(state.globalPlaybackSpeed - 2.0) < 0.01 ? 'active' : ''}" data-speed="2">2x</div>
        <div class="ig-reels-speed-menu-item ${Math.abs(state.globalPlaybackSpeed - 2.5) < 0.01 ? 'active' : ''}" data-speed="2.5">2.5x</div>
        <div class="ig-reels-speed-menu-item ${Math.abs(state.globalPlaybackSpeed - 3.0) < 0.01 ? 'active' : ''}" data-speed="3">3x</div>
      </div>
    </div>
    <span class="ig-control-label ig-speed-label">${state.globalPlaybackSpeed}x</span>
  `;

  const autoskipItem = document.createElement('div');
  autoskipItem.className = 'ig-action-item ig-autoskip-item';
  if (state.globalAutoSkip) {
    autoskipItem.classList.add('active');
  }

  autoskipItem.innerHTML = `
    <div class="ig-control-btn ig-autoskip-btn" title="Auto-skip to next video">
      <svg class="ig-autoskip-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" style="width: 20px; height: 20px;">
        <polyline points="7 13 12 18 17 13"></polyline>
        <polyline points="7 6 12 11 17 6"></polyline>
      </svg>
    </div>
    <span class="ig-control-label">${state.globalAutoSkip ? 'AutoSkip: ON' : 'AutoSkip'}</span>
  `;

  if (!actionBar) {
    video._hasExtraControls = false;
    return;
  }

  actionBar.insertBefore(autoskipItem, actionBar.firstChild);
  actionBar.insertBefore(speedItem, autoskipItem);

  video._speedActionItem = speedItem;
  video._autoskipActionItem = autoskipItem;
  video._floatingControlsContainer = null;

  const speedBtn = speedItem.querySelector('.ig-speed-btn');
  const speedMenu = speedItem.querySelector('.ig-reels-speed-menu');

  let menuTimer = null;
  let isOverSpeedArea = false;

  const markEnter = () => {
    isOverSpeedArea = true;
    clearTimeout(menuTimer);
    speedMenu.classList.add('show');
  };

  const markLeave = () => {
    isOverSpeedArea = false;
    clearTimeout(menuTimer);
    menuTimer = setTimeout(() => {
      if (!isOverSpeedArea) {
        speedMenu.classList.remove('show');
      }
    }, 250);
  };

  speedBtn.addEventListener('mouseenter', markEnter);
  speedBtn.addEventListener('mouseleave', markLeave);
  speedMenu.addEventListener('mouseenter', markEnter);
  speedMenu.addEventListener('mouseleave', markLeave);

  const menuItems = speedItem.querySelectorAll('.ig-reels-speed-menu-item');
  menuItems.forEach(item => {
    const selectSpeed = (e) => {
      e.stopPropagation();
      e.preventDefault();
      const speed = parseFloat(item.getAttribute('data-speed'));
      state.globalPlaybackSpeed = speed;
      saveSettings();
      syncAllVideos();
      menuItems.forEach(i => i.classList.remove('active'));
      item.classList.add('active');
    };

    item.addEventListener('mousedown', selectSpeed, { capture: true });
    item.addEventListener('pointerdown', selectSpeed, { capture: true });
    item.addEventListener('click', selectSpeed, { capture: true });
  });

  const autoskipBtn = autoskipItem.querySelector('.ig-autoskip-btn');

  const toggleAutoSkip = (e) => {
    e.stopPropagation();
    e.preventDefault();

    state.globalAutoSkip = !state.globalAutoSkip;

    if (state.globalAutoSkip) {
      state.lastAutoSkipTime = 0;
      import('./config.js').then(m => {
        m.state.activeVideos.forEach(v => {
          v._autoSkipTriggered = false;

          const duration = v.duration || 0;
          const currentTime = v.currentTime || 0;
          const isNearEnd = duration > 0 && (duration - currentTime <= 0.5);

          if (v.isConnected && (v.ended || isNearEnd)) {
            if (typeof v._oldHandleVideoEnded === 'function') {
              v._oldHandleVideoEnded();
            }
          }
        });
      });
    }

    saveSettings();
    syncAllVideos();

    restorePlayerFocus(video);
  };

  const blockIGInterference = (e) => {
    e.stopPropagation();
  };

  autoskipBtn.addEventListener('mousedown', blockIGInterference, { capture: true });
  autoskipBtn.addEventListener('pointerdown', blockIGInterference, { capture: true });
  autoskipBtn.addEventListener('click', toggleAutoSkip, { capture: true });

  const handleVideoEnded = () => {
    if (!state.globalAutoSkip) return;

    if (document.activeElement) {
      const tag = document.activeElement.tagName.toLowerCase();
      const isEditable = document.activeElement.hasAttribute('contenteditable') ||
        document.activeElement.getAttribute('role') === 'textbox';
      if (tag === 'input' || tag === 'textarea' || isEditable) {
        if (video._autoSkipTriggered) return;
        video._autoSkipTriggered = true;

        const preservedSrc = video.currentSrc;

        setTimeout(() => {
          video._autoSkipTriggered = false;
          if (video.isConnected && video.currentSrc === preservedSrc && video.ended) {
            handleVideoEnded();
          }
        }, 5000);
        return;
      }
    }

    const now = Date.now();
    if (now - state.lastAutoSkipTime < 1000) return;
    if (video._autoSkipTriggered) return;

    state.lastAutoSkipTime = now;
    video._autoSkipTriggered = true;
    setTimeout(() => {
      video._autoSkipTriggered = false;
    }, 1000);

    const isReelsPage = (window.location.pathname.includes('/reels/') || window.location.pathname.includes('/reel/')) || !!video.closest('.x17505xr, .x10b77sg');

    const triggerArrowDown = () => {
      restorePlayerFocus(video);

      const keyEventInit = {
        key: 'ArrowDown',
        keyCode: 40,
        code: 'ArrowDown',
        which: 40,
        bubbles: true,
        cancelable: true,
        view: window
      };

      const targets = [];

      if (document.activeElement) targets.push(document.activeElement);

      const videoWrapper = video.closest('.x17505xr, .x10b77sg') || video.parentElement;
      if (videoWrapper && !targets.includes(videoWrapper)) targets.push(videoWrapper);

      if (!targets.includes(document.body)) targets.push(document.body);
      targets.push(document);

      targets.forEach(t => {
        try {
          t.dispatchEvent(new KeyboardEvent('keydown', keyEventInit));
          t.dispatchEvent(new KeyboardEvent('keyup', keyEventInit));
        } catch (err) {
          console.debug("[IG Volume] Dispatch failed on target", t, err);
        }
      });

      window.dispatchEvent(new KeyboardEvent('keydown', keyEventInit));
      window.dispatchEvent(new KeyboardEvent('keyup', keyEventInit));
    };

    if (isReelsPage) {
      triggerArrowDown();
    } else {
      const reelContainer = video.closest([
        'div[style*="aspect-ratio"]',
        'article',
        '.x17505xr',
        '.x10b77sg',
        '[data-media-id]'
      ].join(', '));

      let nextReel = null;
      if (reelContainer) {
        let next = reelContainer.nextElementSibling;
        while (next) {
          if (next.querySelector('video') || next.matches('article') || next.querySelector('[role="button"]')) {
            nextReel = next;
            break;
          }
          next = next.nextElementSibling;
        }
      }

      if (nextReel) {
        nextReel.scrollIntoView({ behavior: 'smooth', block: 'start' });
      } else {
        let parent = video.parentElement;
        let scrollContainer = null;
        while (parent && parent !== document.documentElement) {
          const style = window.getComputedStyle(parent);
          if (style.overflowY === 'auto' || style.overflowY === 'scroll') {
            scrollContainer = parent;
            break;
          }
          parent = parent.parentElement;
        }

        if (scrollContainer) {
          scrollContainer.scrollBy({ top: window.innerHeight, behavior: 'smooth' });
        } else {
          window.scrollBy({ top: window.innerHeight, behavior: 'smooth' });
        }
      }
    }
  };

  if (video._oldHandleVideoEnded) {
    video.removeEventListener('ended', video._oldHandleVideoEnded);
  }
  if (video._oldHandleTimeUpdateForSkip) {
    video.removeEventListener('timeupdate', video._oldHandleTimeUpdateForSkip);
  }
  if (video._oldHandlePlayRate) {
    video.removeEventListener('play', video._oldHandlePlayRate);
    video.removeEventListener('playing', video._oldHandlePlayRate);
  }
  if (video._oldRateChangeHandler) {
    video.removeEventListener('ratechange', video._oldRateChangeHandler);
  }

  video._oldHandleVideoEnded = handleVideoEnded;
  video.addEventListener('ended', handleVideoEnded);

  const handleTimeUpdateForSkip = () => {
    if (!state.globalAutoSkip || video.paused || video._autoSkipTriggered || (Date.now() - state.lastAutoSkipTime < 1000)) return;
    const duration = video.duration;
    const currentTime = video.currentTime;
    if (duration > 0 && (duration - currentTime <= 0.25)) {
      handleVideoEnded();
    }
  };
  video._oldHandleTimeUpdateForSkip = handleTimeUpdateForSkip;
  video.addEventListener('timeupdate', handleTimeUpdateForSkip);

  const handlePlayRateEnforcement = () => {
    if (video.playbackRate !== state.globalPlaybackSpeed) {
      video.playbackRate = state.globalPlaybackSpeed;
    }
  };
  video._oldHandlePlayRate = handlePlayRateEnforcement;
  video.addEventListener('play', handlePlayRateEnforcement);
  video.addEventListener('playing', handlePlayRateEnforcement);

  const rateChangeHandler = () => {
    if (video._isSyncingSpeed) return;
    if (video.playbackRate !== state.globalPlaybackSpeed) {
      video._isSyncingSpeed = true;
      video.playbackRate = state.globalPlaybackSpeed;
      setTimeout(() => {
        video._isSyncingSpeed = false;
      }, 0);
    }
  };
  video._oldRateChangeHandler = rateChangeHandler;
  video.addEventListener('ratechange', rateChangeHandler);
}

function checkIsReel(video) {
  const path = window.location.pathname;
  return path.includes('/reels/') || path.includes('/reel/');
}