// Recursive overlay neutralization to disable interfering overlays
import { checkIsReel, checkIsStory } from './detection.js';
import { findNativeMuteButton } from './native-button.js';

export function clearOverlayInterference(video) {
  if (!video || !video.isConnected) return;

  const isFullPlayer = checkIsReel(video) || checkIsStory(video) || video.closest('article') || video.closest('[role="dialog"]');
  if (!isFullPlayer) return;

  const boundary = video.closest('section, [role="dialog"], article, .x17505xr, .x10b77sg') || video.parentElement;
  if (!boundary) return;

  let current = video;
  while (current && current !== boundary) {
    const parent = current.parentElement;
    if (!parent) break;

    const siblings = parent.children;
    for (let i = 0; i < siblings.length; i++) {
      const sibling = siblings[i];
      if (sibling !== current) {
        const style = window.getComputedStyle(sibling);
        const isAbsoluteOrFixed = style.position === 'absolute' || style.position === 'fixed';

        const nativeMute = video._nativeMuteBtn || findNativeMuteButton(video);

        const hasInteractiveButton = (() => {
          const checkLabels = (el) => {
            if (!el) return false;
            const label = (el.getAttribute('aria-label') || el.getAttribute('title') || '').toLowerCase();
            return label.includes('close') || label.includes('закрыть') || label.includes('exit') ||
                   label.includes('dismiss') || label.includes('back') || label.includes('назад') ||
                   label.includes('go back') || label.includes('вернуться');
          };
          if (checkLabels(sibling)) return true;
          const interactiveChildren = sibling.querySelectorAll('button, [role="button"], a, [tabindex="0"]');
          for (const child of interactiveChildren) {
            if (checkLabels(child)) return true;
          }
          return false;
        })();

        const isCustomElement = hasInteractiveButton ||
          sibling.classList.contains('ig-volume-slider-container') ||
          sibling.classList.contains('ig-video-scrubber-container') ||
          sibling.classList.contains('ig-inline-speed-btn') ||
          sibling.classList.contains('ig-feed-speed-btn') ||
          sibling.classList.contains('ig-action-item') ||
          sibling.classList.contains('ig-speed-menu') ||
          sibling.classList.contains('ig-reels-speed-menu') ||
          sibling.querySelector('.ig-volume-slider-container, .ig-video-scrubber-container, .ig-inline-speed-btn, .ig-feed-speed-btn, .ig-action-item, .ig-speed-menu, .ig-reels-speed-menu') ||
          (nativeMute && (sibling === nativeMute || sibling.contains(nativeMute)));

        if (isAbsoluteOrFixed && !isCustomElement && style.pointerEvents !== 'none') {
          sibling.style.setProperty('pointer-events', 'none', 'important');
        }
      }
    }

    current = parent;
  }
}