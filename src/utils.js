// Utility functions for geometry, DOM helpers, and safe events
export function findCommonAncestor(el1, el2) {
  if (!el1 || !el2) return el1 || el2 || null;
  const parents1 = [];
  let temp = el1;
  while (temp) {
    parents1.push(temp);
    temp = temp.parentElement;
  }

  temp = el2;
  while (temp) {
    if (parents1.includes(temp)) {
      return temp;
    }
    temp = temp.parentElement;
  }
  return el1.parentElement || el1;
}

export function isClickInsideElement(e, element) {
  if (!element) return false;
  const rect = element.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0 &&
         e.clientX >= rect.left && e.clientX <= rect.right &&
         e.clientY >= rect.top && e.clientY <= rect.bottom;
}

export function safeClick(element) {
  if (!element) return;

  element.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, view: window }));
  element.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window }));
  element.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true, view: window }));
  element.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window }));

  if (typeof element.click === 'function') {
    element.click();
  } else {
    element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
  }
}

export function updateSliderGradient(slider, value) {
  if (!slider) return;
  const pct = value * 100;
  slider.style.background = `linear-gradient(to right, #ffffff 0%, #ffffff ${pct}%, rgba(255, 255, 255, 0.35) ${pct}%, rgba(255, 255, 255, 0.35) 100%)`;
}

export function isSpeakerSVG(svg) {
  if (!svg) return false;
  const paths = Array.from(svg.querySelectorAll('path')).map(p => p.getAttribute('d') || '');
  return paths.some(path =>
    path.startsWith('M1.5 13.3') ||
    path.includes('1.5 13.3') ||
    path.includes('M3 9v6h4') ||
    path.includes('M3 9v6h4l5') ||
    path.includes('M12 3.6v16.8')
  );
}

export function isStoryMuteSVG(svg) {
  if (!svg) return false;
  const label = (svg.getAttribute('aria-label') || svg.getAttribute('title') || '').toLowerCase();
  return label.includes('audio is') || label.includes('звук') || label.includes('audio playing') || label.includes('audio muted');
}

export function getDOMDistanceToAncestor(child, ancestor) {
  let distance = 0;
  let temp = child;
  while (temp && temp !== ancestor) {
    distance++;
    temp = temp.parentElement;
  }
  return distance;
}

export function restorePlayerFocus(video) {
  if (!video) return;
  const playerWrapper = video.closest('div[role="dialog"], article, .x17505xr, .x10b77sg') || video.parentElement;
  if (playerWrapper) {
    if (!playerWrapper.hasAttribute('tabindex')) {
      playerWrapper.setAttribute('tabindex', '-1');
    }
    playerWrapper.focus({ preventScroll: true });
  } else {
    video.focus({ preventScroll: true });
  }
}