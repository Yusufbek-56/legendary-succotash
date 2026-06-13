// Synchronization of volume and playback across all videos
import { state, hasUserInteracted, saveSettings } from './config.js';

export function syncAllVideos() {
  for (const video of state.activeVideos) {
    if (!video.isConnected) {
      state.activeVideos.delete(video);
    }
  }

  state.activeVideos.forEach(video => {
    if (!video.isConnected) return;

    if (video._ignoreVolumechangeTimer) {
      clearTimeout(video._ignoreVolumechangeTimer);
    }

    video._ignoreVolumechange = true;

    if (hasUserInteracted()) {
      const targetVolume = state.globalMuted ? 0 : Math.pow(state.globalSliderValue, 2);
      video.volume = targetVolume;
    }

    const speedBtnPresent = hasSpeedButtonInDOM(video);
    const targetSpeed = speedBtnPresent ? state.globalPlaybackSpeed : 1.0;

    const originalSetter = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'playbackRate').set;
    if (originalSetter) {
      originalSetter.call(video, targetSpeed);
    } else {
      video.playbackRate = targetSpeed;
    }

    if (video._speedActionItem) {
      const label = video._speedActionItem.querySelector('.ig-speed-label');
      if (label) label.textContent = `${state.globalPlaybackSpeed}x`;

      const needle = video._speedActionItem.querySelector('.ig-speed-needle');
      if (needle) {
        needle.style.transform = `rotate(${getNeedleRotationForSpeed(state.globalPlaybackSpeed)}deg)`;
      }

      const menuItems = video._speedActionItem.querySelectorAll('.ig-speed-menu-item');
      menuItems.forEach(item => {
        const itemSpeed = parseFloat(item.getAttribute('data-speed'));
        if (Math.abs(itemSpeed - state.globalPlaybackSpeed) < 0.01) {
          item.classList.add('active');
        } else {
          item.classList.remove('active');
        }
      });
    }

    if (video._storySpeedBtn && video._storySpeedBtn.isConnected) {
      video._storySpeedBtn.textContent = state.globalPlaybackSpeed === 1.0 ? '1x' : `${state.globalPlaybackSpeed}x`;
      video._storySpeedBtn.classList.toggle('ig-speed-active', state.globalPlaybackSpeed !== 1.0);
    }

    if (video._feedSpeedBtn && video._feedSpeedBtn.isConnected) {
      video._feedSpeedBtn.textContent = state.globalPlaybackSpeed === 1.0 ? '1x' : `${state.globalPlaybackSpeed}x`;
      video._feedSpeedBtn.classList.toggle('ig-speed-active', state.globalPlaybackSpeed !== 1.0);
    }

    if (video._autoskipActionItem) {
      const label = video._autoskipActionItem.querySelector('.ig-control-label');
      if (label) {
        label.textContent = state.globalAutoSkip ? 'AutoSkip: ON' : 'AutoSkip';
      }
      if (state.globalAutoSkip) {
        video._autoskipActionItem.classList.add('active');
      } else {
        video._autoskipActionItem.classList.remove('active');
      }
    }

    video._ignoreVolumechangeTimer = setTimeout(() => {
      video._ignoreVolumechange = false;
      video._ignoreVolumechangeTimer = null;
    }, 30);
  });
}

export function hasSpeedButtonInDOM(video) {
  if (video._speedActionItem && video._speedActionItem.isConnected) return true;
  if (video._storySpeedBtn && video._storySpeedBtn.isConnected) return true;
  if (video._feedSpeedBtn && video._feedSpeedBtn.isConnected) return true;
  return false;
}

export function getNeedleRotationForSpeed(speed) {
  if (speed <= 0.25) return -75;
  if (speed <= 0.5) return -45;
  if (speed <= 1.0) return 0;
  if (speed <= 1.25) return 25;
  if (speed <= 1.5) return 50;
  return 75;
}