// Speed dropdown menu UI
import { state, saveSettings } from './config.js';
import { checkIsStory } from './detection.js';
import { syncAllVideos, getNeedleRotationForSpeed } from './sync.js';

let activeSpeedMenu = null;

export function closeSpeedMenu() {
  if (activeSpeedMenu) {
    activeSpeedMenu.remove();
    activeSpeedMenu = null;
  }
}

export function showSpeedMenu(anchorBtn, video) {
  if (activeSpeedMenu && activeSpeedMenu._anchor === anchorBtn) {
    closeSpeedMenu();
    return;
  }

  closeSpeedMenu();

  const menu = document.createElement('div');
  menu.className = 'ig-speed-menu';
  menu._anchor = anchorBtn;
  activeSpeedMenu = menu;

  const speeds = [0.25, 0.5, 0.75, 1.0, 1.25, 1.5, 1.75, 2.0, 2.5, 3.0];
  speeds.forEach(speed => {
    const item = document.createElement('div');
    item.className = 'ig-speed-menu-item';
    if (Math.abs(state.globalPlaybackSpeed - speed) < 0.01) {
      item.classList.add('active');
    }
    item.textContent = speed === 1.0 ? '1x (Normal)' : `${speed}x`;

    const selectSpeed = (ev) => {
      ev.stopPropagation();
      ev.preventDefault();
      state.globalPlaybackSpeed = speed;
      saveSettings();
      syncAllVideos();
      closeSpeedMenu();
    };

    item.addEventListener('click', selectSpeed, { capture: true });
    item.addEventListener('pointerdown', (ev) => ev.stopPropagation(), { capture: true });
    item.addEventListener('mousedown', (ev) => ev.stopPropagation(), { capture: true });

    menu.appendChild(item);
  });

  const blockEvents = (ev) => {
    ev.stopPropagation();
  };
  menu.addEventListener('pointerdown', blockEvents);
  menu.addEventListener('mousedown', blockEvents);
  menu.addEventListener('click', blockEvents);

  document.body.appendChild(menu);

  const updateMenuPosition = () => {
    if (!menu.isConnected || (video && !video.isConnected)) {
      closeSpeedMenu();
      return;
    }
    const menuWidth = 110;
    const menuHeight = menu.offsetHeight || 250;

    const scrubber = video && video._scrubberContainer;
    let top, left;

    const useScrubber = checkIsStory(video) && scrubber && scrubber.isConnected;

    if (useScrubber) {
      const scrubberRect = scrubber.getBoundingClientRect();
      top = scrubberRect.top - menuHeight - 8;
      left = scrubberRect.left + (scrubberRect.width - menuWidth) / 2;
    } else if (anchorBtn && anchorBtn.isConnected) {
      const rect = anchorBtn.getBoundingClientRect();
      top = rect.top - menuHeight - 8;
      left = rect.left + (rect.width - menuWidth) / 2;
    } else {
      closeSpeedMenu();
      return;
    }

    if (top < 10) {
      if (useScrubber) {
        const scrubberRect = scrubber.getBoundingClientRect();
        top = scrubberRect.bottom + 8;
      } else if (anchorBtn && anchorBtn.isConnected) {
        const rect = anchorBtn.getBoundingClientRect();
        top = rect.bottom + 8;
      }
    }

    if (left < 10) left = 10;
    if (left + menuWidth > window.innerWidth - 10) {
      left = window.innerWidth - menuWidth - 10;
    }

    menu.style.top = `${top}px`;
    menu.style.left = `${left}px`;
  };

  updateMenuPosition();
  setTimeout(updateMenuPosition, 0);
}

window.addEventListener('pointerdown', (e) => {
  if (activeSpeedMenu) {
    const isAnchorClick = activeSpeedMenu._anchor && activeSpeedMenu._anchor.contains(e.target);
    const isMenuClick = activeSpeedMenu.contains(e.target);
    if (!isAnchorClick && !isMenuClick) {
      closeSpeedMenu();
    }
  }
}, { capture: true, passive: true });

window.addEventListener('scroll', closeSpeedMenu, { passive: true });
window.addEventListener('resize', closeSpeedMenu, { passive: true });