// Video type detection and player identification
export function checkIsReel(video) {
  if (!video) return false;
  const path = window.location.pathname;
  return path.includes('/reels/') || path.includes('/reel/');
}

export function checkIsStory(video) {
  if (!video) return false;
  const path = window.location.pathname;
  return path.includes('/stories/');
}

export function findReelsActionBar(video) {
  const videoRect = video.getBoundingClientRect();
  if (videoRect.width === 0 || videoRect.height === 0) return null;

  const buttons = Array.from(document.querySelectorAll('button, [role="button"], div[tabindex="0"]'));
  const actionButtons = buttons.filter(btn => {
    const rect = btn.getBoundingClientRect();
    const isNearRight = Math.abs(rect.left - videoRect.right) < 150 || (rect.left > videoRect.left && rect.right < videoRect.right + 100 && rect.left > videoRect.right - 100);
    const overlapsVertically = rect.top < videoRect.bottom && rect.bottom > videoRect.top;
    return isNearRight && overlapsVertically;
  });

  if (actionButtons.length === 0) return null;

  const parentMap = new Map();
  actionButtons.forEach(btn => {
    let p = btn.parentElement;
    for (let i = 0; i < 4 && p && p !== document.body; i++) {
      const style = window.getComputedStyle(p);
      if (style.display === 'flex' && (style.flexDirection === 'column' || style.flexDirection === 'column-reverse')) {
        parentMap.set(p, (parentMap.get(p) || 0) + 1);
      }
      p = p.parentElement;
    }
  });

  let bestContainer = null;
  let maxCount = 0;
  parentMap.forEach((count, p) => {
    if (count > maxCount) {
      maxCount = count;
      bestContainer = p;
    }
  });

  if (bestContainer && maxCount >= 2) {
    return bestContainer;
  }

  const fallbackSelectors = ['.x17505xr', '.x1a2a7hz', '.xcdnw81', '.x1ld4z81'];
  for (const sel of fallbackSelectors) {
    const containers = Array.from(document.querySelectorAll(sel));
    for (const c of containers) {
      const rect = c.getBoundingClientRect();
      if (rect.width > 0 && Math.abs(rect.left - videoRect.right) < 120 && rect.top < videoRect.bottom && rect.bottom > videoRect.top) {
        return c;
      }
    }
  }

  return null;
}

export function isMainPlayer(video) {
  if (!video) return false;

  if (checkIsStory(video)) return true;
  if (video.closest('[role="dialog"]')) return true;

  const path = window.location.pathname;
  const segments = path.split('/').filter(Boolean);
  const firstSegment = segments[0] || '';

  const isDetailView = path.includes('/reel/') || path.includes('/p/') || path.includes('/stories/');

  const isProfile = !isDetailView && segments.length > 0 && ![
    'reels', 'reel', 'stories', 'explore', 'direct', 'p'
  ].includes(firstSegment);

  const isExplore = !isDetailView && firstSegment === 'explore';

  if (isProfile || isExplore) {
    return false;
  }

  if (path.includes('/p/')) return true;

  return checkIsReel(video) || video.closest('article');
}