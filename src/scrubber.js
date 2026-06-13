// Progress bar injection and scrubbing logic
import { findCommonAncestor } from './utils.js';
import { findNativeMuteButton } from './native-button.js';

export function updateScrubberPosition(video, scrubberContainer) {
  if (!video.isConnected || !scrubberContainer.isConnected) return;

  const rect = video.getBoundingClientRect();
  const parent = scrubberContainer.parentElement;
  const offsetRect = parent.getBoundingClientRect();

  const lastScrubber = video._lastScrubberRect;
  if (lastScrubber &&
    Math.abs(lastScrubber.left - rect.left) < 0.5 &&
    Math.abs(lastScrubber.width - rect.width) < 0.5 &&
    Math.abs(lastScrubber.bottom - rect.bottom) < 0.5 &&
    Math.abs(lastScrubber.parentBottom - offsetRect.bottom) < 0.5) {
    return;
  }

  video._lastScrubberRect = {
    left: rect.left,
    width: rect.width,
    bottom: rect.bottom,
    parentBottom: offsetRect.bottom
  };

  const left = rect.left - offsetRect.left;
  const width = rect.width;
  const bottom = offsetRect.bottom - rect.bottom;

  scrubberContainer.style.setProperty('left', `${left}px`, 'important');
  scrubberContainer.style.setProperty('width', `${width}px`, 'important');
  scrubberContainer.style.setProperty('bottom', `${bottom}px`, 'important');
}

export function injectScrubber(video) {
  if (video._hasScrubber) return;
  video._hasScrubber = true;

  video._lastScrubberRect = null;

  const nativeBtn = video._nativeMuteBtn || findNativeMuteButton(video);
  const container = findCommonAncestor(video, nativeBtn) || video.parentElement;

  const containerStyle = window.getComputedStyle(container);
  if (containerStyle.position === 'static') {
    container.style.position = 'relative';
  }

  const scrubberContainer = document.createElement('div');
  scrubberContainer.className = 'ig-video-scrubber-container';

  scrubberContainer.innerHTML = `
    <div class="ig-video-scrubber-progress-bg" style="pointer-events: none;">
      <div class="ig-video-scrubber-progress-bar" style="pointer-events: none;"></div>
    </div>
    <div class="ig-video-scrubber-thumb" style="pointer-events: none;"></div>
  `;

  container.appendChild(scrubberContainer);
  video._scrubberContainer = scrubberContainer;

  const progressBg = scrubberContainer.querySelector('.ig-video-scrubber-progress-bg');
  const fillBar = scrubberContainer.querySelector('.ig-video-scrubber-progress-bar');
  const thumb = scrubberContainer.querySelector('.ig-video-scrubber-thumb');

  scrubberContainer.style.setProperty('position', 'absolute', 'important');
  scrubberContainer.style.setProperty('height', '16px', 'important');
  scrubberContainer.style.setProperty('cursor', 'pointer', 'important');
  scrubberContainer.style.setProperty('z-index', '2147483647', 'important');
  scrubberContainer.style.setProperty('display', 'flex', 'important');
  scrubberContainer.style.setProperty('align-items', 'flex-end', 'important');
  scrubberContainer.style.setProperty('pointer-events', 'auto', 'important');

  progressBg.style.setProperty('position', 'relative', 'important');
  progressBg.style.setProperty('width', '100%', 'important');
  progressBg.style.setProperty('height', '3px', 'important');
  progressBg.style.setProperty('background-color', 'rgba(255, 255, 255, 0.3)', 'important');
  progressBg.style.setProperty('transition', 'height 0.1s ease', 'important');
  progressBg.style.setProperty('pointer-events', 'none', 'important');

  fillBar.style.setProperty('position', 'absolute', 'important');
  fillBar.style.setProperty('left', '0', 'important');
  fillBar.style.setProperty('top', '0', 'important');
  fillBar.style.setProperty('height', '100%', 'important');
  fillBar.style.setProperty('width', '0%', 'important');
  fillBar.style.setProperty('background-color', '#ffffff', 'important');
  fillBar.style.setProperty('pointer-events', 'none', 'important');

  thumb.style.setProperty('position', 'absolute', 'important');
  thumb.style.setProperty('bottom', '0px', 'important');
  thumb.style.setProperty('width', '10px', 'important');
  thumb.style.setProperty('height', '10px', 'important');
  thumb.style.setProperty('border-radius', '50%', 'important');
  thumb.style.setProperty('background-color', '#ffffff', 'important');
  thumb.style.setProperty('transform', 'translate(-50%, 35%)', 'important');
  thumb.style.setProperty('opacity', '0', 'important');
  thumb.style.setProperty('transition', 'opacity 0.1s ease', 'important');
  thumb.style.setProperty('pointer-events', 'none', 'important');

  updateScrubberPosition(video, scrubberContainer);

  let isDragging = false;

  scrubberContainer.addEventListener('mouseenter', () => {
    progressBg.style.height = '6px';
    thumb.style.opacity = '1';
  });

  scrubberContainer.addEventListener('mouseleave', () => {
    if (!isDragging) {
      progressBg.style.height = '3px';
      thumb.style.opacity = '0';
    }
  });

  function updateProgressVisuals(percentage) {
    const pct = Math.max(0, Math.min(100, percentage));
    fillBar.style.width = `${pct}%`;
    thumb.style.left = `${pct}%`;
  }

  const handleTimeUpdate = () => {
    if (isDragging) return;
    const duration = video.duration || 0;
    const currentTime = video.currentTime || 0;
    if (duration > 0) {
      updateProgressVisuals((currentTime / duration) * 100);
    } else {
      updateProgressVisuals(0);
    }
  };

  video.addEventListener('timeupdate', handleTimeUpdate);
  video.addEventListener('loadedmetadata', handleTimeUpdate);

  let updateTicker = null;
  const handleDrag = (e) => {
    const rect = scrubberContainer.getBoundingClientRect();
    const clientX = e.clientX || (e.touches && e.touches[0] ? e.touches[0].clientX : 0);
    const clickX = clientX - rect.left;
    const percentage = (clickX / rect.width) * 100;
    const clampedPercentage = Math.max(0, Math.min(100, percentage));

    updateProgressVisuals(clampedPercentage);

    if (updateTicker) cancelAnimationFrame(updateTicker);
    updateTicker = requestAnimationFrame(() => {
      const duration = video.duration || 0;
      if (duration > 0) {
        video.currentTime = (clampedPercentage / 100) * duration;
      }
    });
  };

  const handlePointerDown = (e) => {
    isDragging = true;
    scrubberContainer.classList.add('ig-active');
    handleDrag(e);

    e.preventDefault();
    e.stopPropagation();

    const handlePointerMove = (moveEvent) => {
      if (!isDragging) return;
      handleDrag(moveEvent);
    };

    const handlePointerUp = () => {
      isDragging = false;
      scrubberContainer.classList.remove('ig-active');
      if (!scrubberContainer.matches(':hover')) {
        progressBg.style.height = '3px';
        thumb.style.opacity = '0';
      }
      document.removeEventListener('pointermove', handlePointerMove, { capture: true });
      document.removeEventListener('pointerup', handlePointerUp, { capture: true });
    };

    document.addEventListener('pointermove', handlePointerMove, { capture: true });
    document.addEventListener('pointerup', handlePointerUp, { capture: true });
  };

  scrubberContainer.addEventListener('pointerdown', handlePointerDown, { capture: true });
  scrubberContainer.addEventListener('click', (e) => {
    e.stopPropagation();
    e.preventDefault();
  }, { capture: true });
  scrubberContainer.addEventListener('mousedown', (e) => {
    e.stopPropagation();
  }, { capture: true });

  ['dragstart', 'selectstart'].forEach(eventName => {
    scrubberContainer.addEventListener(eventName, (e) => {
      e.stopPropagation();
      e.preventDefault();
    }, { capture: true });
  });
}