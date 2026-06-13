import { state, saveSettings } from './config.js';
import { findCommonAncestor, updateSliderGradient } from './utils.js';
import { syncAllVideos } from './sync.js';

export function injectVolumeSlider(video, nativeMuteBtn) {
  if (video._hasVolumeSlider) return;
  if (!video.isConnected || !nativeMuteBtn || !nativeMuteBtn.isConnected) return;

  const parent = findCommonAncestor(video, nativeMuteBtn) || video.parentElement;
  if (!parent) return;

  if (window.getComputedStyle(parent).position === 'static') {
    parent.style.position = 'relative';
  }

  const container = document.createElement('div');
  container.className = 'ig-volume-slider-container';
  container.innerHTML = `<input type="range" class="ig-volume-slider" min="0" max="100" value="${Math.round(state.globalSliderValue * 100)}">`;

  parent.appendChild(container);
  video._sliderContainer = container;
  video._hasVolumeSlider = true;

  const slider = container.querySelector('.ig-volume-slider');
  updateSliderGradient(slider, state.globalSliderValue);

  const updatePosition = () => {
    if (!container.isConnected || !nativeMuteBtn.isConnected) return;
    const muteRect = nativeMuteBtn.getBoundingClientRect();
    const pRect = parent.getBoundingClientRect();
    const bottom = pRect.bottom - muteRect.bottom + (muteRect.height - 28) / 2;
    container.style.bottom = `${bottom}px`;
    container.style.right = `${pRect.right - muteRect.left}px`;
    container.classList.remove('ig-left-aligned');
    container.classList.add('ig-right-aligned');
  };

  updatePosition();

  let collapseTimer;
  const expand = () => {
    clearTimeout(collapseTimer);
    container.classList.add('ig-expanded');
  };
  const collapse = () => {
    clearTimeout(collapseTimer);
    collapseTimer = setTimeout(() => {
      if (!container.matches(':hover') && !nativeMuteBtn.matches(':hover')) {
        container.classList.remove('ig-expanded');
      }
    }, 250);
  };

  nativeMuteBtn.addEventListener('mouseenter', expand, { passive: true });
  nativeMuteBtn.addEventListener('mouseleave', collapse, { passive: true });
  container.addEventListener('mouseenter', expand, { passive: true });
  container.addEventListener('mouseleave', collapse, { passive: true });

  slider.addEventListener('input', () => {
    const val = parseInt(slider.value, 10) / 100;
    state.globalSliderValue = val;
    state.globalMuted = val === 0;
    state.lastUserInteractionTime = Date.now();
    updateSliderGradient(slider, val);
    saveSettings();
    syncAllVideos();
  });

  slider.addEventListener('pointerdown', (e) => e.stopPropagation());
  slider.addEventListener('mousedown', (e) => e.stopPropagation());
}
