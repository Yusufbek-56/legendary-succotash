// Stories inline speed button injection
import { state, saveSettings } from './config.js';
import { checkIsStory } from './detection.js';
import { enforcePlaybackRate } from './reels-controls.js';
import { showSpeedMenu } from './speed-menu.js';

export function injectStorySpeedButton(video) {
  if (video._hasStorySpeedBtn) return;
  if (!checkIsStory(video)) return;

  const storySection = video.closest('section, ._as3a, ._abag, [role="dialog"]');
  if (!storySection) return;

  const header = storySection.querySelector('header');
  const headerButtons = header
    ? header.querySelectorAll('button, [role="button"]')
    : storySection.querySelectorAll('button, [role="button"]');
  if (headerButtons.length === 0) return;

  const videoRect = video.getBoundingClientRect();
  let rightmostBtn = null;
  let maxRight = -Infinity;

  for (const btn of headerButtons) {
    if (btn.closest('._ac7v')) continue;
    const rect = btn.getBoundingClientRect();

    const inUpperThird = rect.top < videoRect.top + videoRect.height * 0.25;
    const withinHorizontalBounds = rect.left >= videoRect.left - 10 && rect.right <= videoRect.right + 10;

    if (inUpperThird && withinHorizontalBounds && rect.width > 0 && rect.width < 60) {
      if (rect.right > maxRight) {
        maxRight = rect.right;
        rightmostBtn = btn;
      }
    }
  }

  if (!rightmostBtn) return;

  video._hasStorySpeedBtn = true;

  const speedBtn = document.createElement('div');
  speedBtn.className = 'ig-inline-speed-btn';
  speedBtn.textContent = state.globalPlaybackSpeed === 1.0 ? '1x' : `${state.globalPlaybackSpeed}x`;
  if (state.globalPlaybackSpeed !== 1.0) speedBtn.classList.add('ig-speed-active');
  speedBtn.title = 'Toggle playback speed';

  speedBtn.style.cssText = `
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    border-radius: 50%;
    background: rgba(0,0,0,0.4);
    color: #fff;
    font-size: 11px;
    font-weight: 700;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    cursor: pointer;
    user-select: none;
    pointer-events: auto !important;
    margin-left: 8px;
    flex-shrink: 0;
    transition: background 0.2s ease, transform 0.15s ease;
    z-index: 10;
    filter: drop-shadow(0 1px 2px rgba(0,0,0,0.5));
    letter-spacing: -0.5px;
  `;

  const btnParent = rightmostBtn.parentElement;
  if (btnParent) {
    rightmostBtn.insertAdjacentElement('afterend', speedBtn);
  } else {
    video._hasStorySpeedBtn = false;
    return;
  }

  video._storySpeedBtn = speedBtn;
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
    speedBtn.style.background = speedBtn.classList.contains('ig-speed-active') ? 'rgba(0,149,246,0.6)' : 'rgba(0,0,0,0.4)';
  });
}