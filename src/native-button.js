// Native mute button detection and synchronization
import { findCommonAncestor, getDOMDistanceToAncestor, isSpeakerSVG, isStoryMuteSVG, safeClick } from './utils.js';
import { state, hasUserInteracted } from './config.js';
import { checkIsReel, checkIsStory } from './detection.js';

export function isNativeButtonMuted(nativeBtn, video) {
  const label = (nativeBtn.getAttribute('aria-label') || nativeBtn.getAttribute('title') || '').toLowerCase();
  if (label) {
    const isMutedLabel =
      label.includes('unmute') ||
      label.includes('un-mute') ||
      label.includes('включить') ||
      label.includes('réactiver') ||
      label.includes('reactiver') ||
      label.includes('aufheben') ||
      label.includes('einschalten') ||
      label.includes('inschakelen') ||
      label.includes('wyłącz wyciszenie') ||
      label.includes('解除') ||
      label.includes('해제') ||
      (label.includes('activar') && !label.includes('desactivar')) ||
      (label.includes('attiva') && !label.includes('disattiva')) ||
      label.includes('sesi aç') ||
      label.includes('ouvrir');

    const isUnmutedLabel =
      label.includes('выключить') ||
      label.includes('desactivar') ||
      label.includes('désactiver') ||
      label.includes('disattiva') ||
      label.includes('couper') ||
      label.includes('stummschalten') ||
      label.includes('kıs') ||
      label.includes('dempen') ||
      label.includes('wycisz') ||
      label.includes('静音') ||
      label.includes('음со거') ||
      (label.includes('mute') && !label.includes('unmute') && !label.includes('un-mute'));

    if (isMutedLabel) return true;
    if (isUnmutedLabel) return false;
  }

  const svg = nativeBtn.querySelector('svg');
  if (svg) {
    const paths = Array.from(svg.querySelectorAll('path')).map(p => p.getAttribute('d') || '');
    const hasMuteSlash = paths.some(path =>
      path.startsWith('M1.5 13.3') ||
      path.includes('M1.5 13.3') ||
      path.includes('1.5 13.3') ||
      (path.includes('M1.5') && path.includes('13.3'))
    );
    if (hasMuteSlash) return true;

    const lines = Array.from(svg.querySelectorAll('line'));
    const hasMuteLine = lines.some(line => {
      const x1 = parseFloat(line.getAttribute('x1'));
      const y1 = parseFloat(line.getAttribute('y1'));
      const x2 = parseFloat(line.getAttribute('x2'));
      const y2 = parseFloat(line.getAttribute('y2'));
      return Math.abs(x1 - x2) > 8 && Math.abs(y1 - y2) > 8;
    });
    if (hasMuteLine) return true;
  }

  return false;
}

export function findNativeMuteButton(video) {
  let playerContainer;
  if (checkIsStory(video)) {
    playerContainer = video.closest('section, [role="dialog"], ._as3a, ._abag, ._abaj, ._abak, ._abal');
  } else {
    playerContainer = video.closest('div[role="dialog"], article, .x17505xr, .x10b77sg, .x1qjc9v5, .x1ld4z81');
  }
  if (!playerContainer) {
    playerContainer = video.parentElement?.parentElement || video.parentElement || video;
  }
  const searchRoot = playerContainer;

  const svgs = Array.from(searchRoot.querySelectorAll('svg'));
  let bestSvg = null;
  let minDistance = Infinity;

  for (const svg of svgs) {
    if (svg.closest('._ac7v')) continue;

    const isMuteIndicator = isSpeakerSVG(svg) || isStoryMuteSVG(svg);
    if (isMuteIndicator) {
      const ancestor = findCommonAncestor(video, svg);
      if (ancestor) {
        const dist = getDOMDistanceToAncestor(video, ancestor);
        if (dist < minDistance) {
          minDistance = dist;
          bestSvg = svg;
        }
      }
    }
  }

  if (!bestSvg) {
    const rootRect = video.getBoundingClientRect();
    let minDistanceToCorner = Infinity;

    for (const svg of svgs) {
      const rect = svg.getBoundingClientRect();

      const inRightHalf = rect.left > rootRect.left + (rootRect.width / 3);
      const inBottomHalf = rect.top > rootRect.top + (rootRect.height / 3);

      const withinVideoBounds = rect.left >= rootRect.left && rect.right <= rootRect.right + 80 &&
        rect.top >= rootRect.top && rect.bottom <= rootRect.bottom + 80;

      if (inRightHalf && inBottomHalf && withinVideoBounds) {
        const distanceToCorner = Math.hypot(rootRect.right - rect.right, rootRect.bottom - rect.bottom);
        if (distanceToCorner < minDistanceToCorner) {
          minDistanceToCorner = distanceToCorner;
          bestSvg = svg;
        }
      }
    }
  }

  if (bestSvg) {
    let clickable = bestSvg;
    for (let k = 0; k < 5 && clickable && clickable !== searchRoot; k++) {
      const tagName = clickable.tagName;
      const isButton = tagName === 'BUTTON' ||
        clickable.getAttribute('role') === 'button' ||
        clickable.getAttribute('tabindex') === '0' ||
        clickable.classList.contains('x1i10hfl') ||
        clickable.classList.contains('_abl-');
      if (isButton) return clickable;
      clickable = clickable.parentElement;
    }
    return bestSvg.parentElement || bestSvg;
  }

  const candidates = Array.from(searchRoot.querySelectorAll('button, [role="button"], div[tabindex="0"]'));
  const labelKeywords = ['mute', 'unmute', 'volume', 'audio', 'sound', 'звук', 'динамик', 'выкл', 'вкл'];
  let bestCand = null;
  let minCandDistance = Infinity;

  for (const cand of candidates) {
    const label = (cand.getAttribute('aria-label') || cand.getAttribute('title') || '').toLowerCase();
    if (labelKeywords.some(keyword => label.includes(keyword))) {
      const ancestor = findCommonAncestor(video, cand);
      if (ancestor) {
        const dist = getDOMDistanceToAncestor(video, ancestor);
        if (dist < minCandDistance) {
          minCandDistance = dist;
          bestCand = cand;
        }
      }
    }
  }

  return bestCand;
}

export function syncNativeButtonMuteState(video) {
  const nativeBtn = video._nativeMuteBtn || findNativeMuteButton(video);
  if (!nativeBtn) return;

  if (video._ignoreMuteBtnSync || video._isSyncingMute) return;

  const iconShowsMuted = isNativeButtonMuted(nativeBtn, video);

  if (iconShowsMuted !== state.globalMuted) {
    video._isSyncingMute = true;
    nativeBtn._ignoreClick = true;

    const prevIgnoreVolumechange = video._ignoreVolumechange;
    video._ignoreVolumechange = true;

    safeClick(nativeBtn);

    setTimeout(() => {
      nativeBtn._ignoreClick = false;
      video._ignoreVolumechange = prevIgnoreVolumechange;
      video._isSyncingMute = false;
    }, 30);
  }
}