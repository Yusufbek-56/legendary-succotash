// Feed post speed button injection
import { state, saveSettings } from './config.js';
import { findCommonAncestor } from './utils.js';
import { checkIsReel, checkIsStory } from './detection.js';
import { enforcePlaybackRate } from './reels-controls.js';
import { showSpeedMenu } from './speed-menu.js';

export function injectFeedSpeedButton(video, nativeMuteBtn) {
  if (video._hasFeedSpeedBtn) return;
  if (checkIsReel(video) || checkIsStory(video)) return;

  const container = video.closest('article, [role="dialog"]');
  if (!container) return;

  video._hasFeedSpeedBtn = true;

  const speedBtn = document.createElement('div');
  speedBtn.className = 'ig-inline-speed-btn ig-feed-speed-btn';
  speedBtn.textContent = state.globalPlaybackSpeed === 1.0 ? '1x' : `${state.globalPlaybackSpeed}x`;
  if (state.globalPlaybackSpeed !== 1.0) speedBtn.classList.add('ig-speed-active');
  speedBtn.title = 'Toggle playback speed';

  speedBtn.style.cssText = `
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    border-radius: 50%;
    background: rgba(0,0,0,0.5);
    color: #fff;
    font-size: 10px;
    font-weight: 700;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    cursor: pointer;
    user-select: none;
    pointer-events: auto !important;
    position: absolute;
    z-index: 10;
    filter: drop-shadow(0 1px 2px rgba(0,0,0,0.5));
    transition: background 0.2s ease, transform 0.15s ease, opacity 0.2s ease;
    letter-spacing: -0.5px;
    opacity: 1;
  `;

  let mountParent;
  let updateFeedSpeedPos;

  if (nativeMuteBtn && nativeMuteBtn.isConnected) {
    const muteRect = nativeMuteBtn.getBoundingClientRect();
    const videoRect = video.getBoundingClientRect();

    mountParent = findCommonAncestor(video, nativeMuteBtn) || video.parentElement;
    const mountParentStyle = window.getComputedStyle(mountParent);
    if (mountParentStyle.position === 'static') {
      mountParent.style.position = 'relative';
    }

    mountParent.classList.add('ig-speed-parent');
    mountParent.appendChild(speedBtn);

    updateFeedSpeedPos = () => {
      if (!speedBtn.isConnected || !nativeMuteBtn.isConnected) return;
      const mR = nativeMuteBtn.getBoundingClientRect();
      const pR = mountParent.getBoundingClientRect();
      speedBtn.style.bottom = `${pR.bottom - mR.bottom + (mR.height - 28) / 2}px`;
      speedBtn.style.right = `${pR.right - mR.left + 4}px`;
    };
  } else {
    mountParent = video.parentElement || container;
    const mountParentStyle = window.getComputedStyle(mountParent);
    if (mountParentStyle.position === 'static') {
      mountParent.style.position = 'relative';
    }

    mountParent.classList.add('ig-speed-parent');
    mountParent.appendChild(speedBtn);

    updateFeedSpeedPos = () => {
      if (!speedBtn.isConnected) return;
      speedBtn.style.bottom = '12px';
      speedBtn.style.right = '12px';
    };
  }

  updateFeedSpeedPos();
  video._updateFeedSpeedPos = updateFeedSpeedPos;

  video._feedSpeedBtn = speedBtn;
  import('./config.js').then(m => m.state.activeVideos.add(video));
  enforcePlaybackRate(video);

  const toggleSpeed = (e) => {
    if (e) {
      e.stopPropagation();
      e.preventDefault();
    }
    showSpeedMenu(speedBtn, video);
  };

  speedBtn.addEventListener('pointerdown', (e) => { e.stopPropagation(); }, { capture: true });
  speedBtn.addEventListener('mousedown', (e) => { e.stopPropagation(); }, { capture: true });
  speedBtn.addEventListener('click', toggleSpeed, { capture: true });

  speedBtn.addEventListener('mouseenter', () => { speedBtn.style.background = 'rgba(255,255,255,0.25)'; });
  speedBtn.addEventListener('mouseleave', () => {
    speedBtn.style.background = speedBtn.classList.contains('ig-speed-active') ? 'rgba(0,149,246,0.6)' : 'rgba(0,0,0,0.5)';
  });
}