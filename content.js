/* ==========================================
   Instagram Volume Controller - Content Script
   Фикс: используем JS mouseenter/mouseleave
   вместо CSS :hover (Instagram перехватывает события)
   ========================================== */

// --- ИНЪЕКЦИЯ СТИЛЕЙ ДЛЯ ЗА ЗАЩИТЫ СЛОЕВ И ЯРКОСТИ ---
function injectCoreStyles() {
  // Агрессивная зачистка любых старых, фантомных или дублирующихся стилей расширения в DOM
  document.querySelectorAll('style').forEach(styleTag => {
    if (
      styleTag.id === 'ig-volume-controller-core-styles' ||
      styleTag.textContent.includes('ig-volume-slider-container') ||
      styleTag.textContent.includes('ig-video-scrubber-container')
    ) {
      styleTag.remove();
    }
  });

  const style = document.createElement('style');
  style.id = 'ig-volume-controller-core-styles';
  style.textContent = `
    /* СЕЙФГАРД СЕТКИ ПРОФИЛЯ: Гарантируем кликабельность и курсор-указатель всем публикациям и ссылкам в рабочей области */
    main[role="main"] a, 
    main[role="main"] a *,
    main[role="main"] [role="link"],
    main[role="main"] [role="link"] * {
      pointer-events: auto !important;
      cursor: pointer !important;
    }

    /* Отключаем перехват мыши у фоновых градиентов, слоев перелистывания и нативных нижних линеек строго внутри плееров */
    article ._ac9s, .x17505xr ._ac9s, .x10b77sg ._ac9s, [role="dialog"] ._ac9s, ._as3a ._ac9s,
    article ._ab9m, .x17505xr ._ab9m, .x10b77sg ._ab9m, [role="dialog"] ._ab9m, ._as3a ._ab9m,
    article ._aajy, .x17505xr ._aajy, .x10b77sg ._aajy, [role="dialog"] ._aajy, ._as3a ._aajy,
    article ._aa_g, .x17505xr ._aa_g, .x10b77sg ._aa_g, [role="dialog"] ._aa_g, ._as3a ._aa_g,
    article ._aa8h, .x17505xr ._aa8h, .x10b77sg ._aa8h, [role="dialog"] ._aa8h, ._as3a ._aa8h,
    article ._aa8j, .x17505xr ._aa8j, .x10b77sg ._aa8j, [role="dialog"] ._aa8j, ._as3a ._aa8j {
      pointer-events: none !important;
    }
    /* Изолируем невидимый прямоугольник нижней панели ввода сторис, чтобы мышь проходила сквозь его пустые зоны */
    ._ac7v {
      pointer-events: none !important;
    }
    /* Возвращаем полную кликабельность элементам управления, полям ввода и кнопкам реакций внутри панели сторис */
    ._ac7v button, 
    ._ac7v form, 
    ._ac7v input, 
    ._ac7v textarea,
    ._ac7v [role="button"],
    .ig-volume-slider-container, 
    .ig-video-scrubber-container, 
    .ig-action-item, 
    .ig-inline-speed-btn, 
    input[type="range"],
    video,
    form,
    input,
    textarea,
    button,
    [role="button"] {
      pointer-events: auto !important;
    }
    /* Убираем блеклость скруббера, делаем его контрастным и сочным */
    .ig-video-scrubber-container {
      opacity: 1 !important;
      filter: none !important;
      mix-blend-mode: normal !important;
    }
  `;
  (document.head || document.documentElement).appendChild(style);
}
injectCoreStyles();

// --- БЕЗОПАСНАЯ ПРОВЕРКА НА ПЕРЕЗАПУСК РАСШИРЕНИЯ ---
function isScriptOrphaned() {
  if (window.__IS_MOCK_TEST__) return false;
  try {
    return typeof chrome === 'undefined' || !chrome.runtime?.id;
  } catch (e) {
    return true;
  }
}

// --- ХЕЛПЕР ГЕОМЕТРИИ КЛИКА ВНУТРИ ЭЛЕМЕНТА ---
function isClickInsideElement(e, element) {
  if (!element) return false;
  const rect = element.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0 &&
         e.clientX >= rect.left && e.clientX <= rect.right &&
         e.clientY >= rect.top && e.clientY <= rect.bottom;
}

// --- ГЛОБАЛЬНЫЕ НАСТРОЙКИ ---
let globalSliderValue = 0.8;
let globalMuted = false;
let globalPlaybackSpeed = 1.0;
let globalAutoSkip = false;
let firstUnmuteTriggered = false; // Флаг первой разблокировки звука при загрузке страницы
const activeVideos = new Set();
let lastUserInteractionTime = 0; // Время последнего действия пользователя с громкостью
let lastAutoSkipTime = 0; // Глобальный коулдаун автопропуска для предотвращения двойных перелистываний
let lastGlobalPath = window.location.pathname; // Глобальный трекер SPA-переходов
let globalScanInterval = null;

// Проверяет, было ли хоть одно взаимодействие пользователя с элементами громкости.
// Пока пользователь не кликнул по кнопке звука / не двигал слайдер / не крутил колёсико,
// мы НЕ трогаем видео, чтобы не ломать autoplay-политику браузера.
function hasUserInteracted() {
  return lastUserInteractionTime > 0;
}

// --- ХРАНИЛИЩЕ (ОБОРУДОВАННОЕ ЗАЩИТОЙ КОНТЕКСТА) ---
function safeGetSettings() {
  try {
    if (typeof chrome !== 'undefined' && chrome.runtime?.id && chrome.storage?.local) {
      chrome.storage.local.get(['igGlobalVolume', 'igGlobalMuted', 'igPlaybackSpeed', 'igAutoSkip'], (data) => {
        if (isScriptOrphaned()) return;
        if (data.igGlobalVolume !== undefined) globalSliderValue = parseFloat(data.igGlobalVolume);
        if (data.igGlobalMuted !== undefined) globalMuted = !!data.igGlobalMuted;
        if (data.igPlaybackSpeed !== undefined) globalPlaybackSpeed = parseFloat(data.igPlaybackSpeed);
        if (data.igAutoSkip !== undefined) globalAutoSkip = !!data.igAutoSkip;
        syncAllVideos();
      });
    }
  } catch (e) {
    console.debug("[IG Volume] Storage read deferred due to context invalidation.", e);
  }
}
safeGetSettings();

function saveSettings() {
  try {
    if (typeof chrome !== 'undefined' && chrome.runtime?.id && chrome.storage?.local) {
      chrome.storage.local.set({
        igGlobalVolume: globalSliderValue,
        igGlobalMuted: globalMuted,
        igPlaybackSpeed: globalPlaybackSpeed,
        igAutoSkip: globalAutoSkip
      });
    }
  } catch (e) {
    console.debug("[IG Volume] Storage write deferred due to context invalidation.", e);
  }
}

let activeSpeedMenu = null;

function closeSpeedMenu() {
  if (activeSpeedMenu) {
    activeSpeedMenu.remove();
    activeSpeedMenu = null;
  }
}

// Global click-outside listener to close the speed menu
window.addEventListener('pointerdown', (e) => {
  if (activeSpeedMenu) {
    const isAnchorClick = activeSpeedMenu._anchor && activeSpeedMenu._anchor.contains(e.target);
    const isMenuClick = activeSpeedMenu.contains(e.target);
    if (!isAnchorClick && !isMenuClick) {
      closeSpeedMenu();
    }
  }
}, { capture: true, passive: true });

// Close speed menu on scroll or resize
window.addEventListener('scroll', closeSpeedMenu, { passive: true });
window.addEventListener('resize', closeSpeedMenu, { passive: true });

function showSpeedMenu(anchorBtn, video) {
  // If menu is already open for this anchor, toggle it off
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
    if (Math.abs(globalPlaybackSpeed - speed) < 0.01) {
      item.classList.add('active');
    }
    item.textContent = speed === 1.0 ? '1x (Normal)' : `${speed}x`;

    const selectSpeed = (ev) => {
      ev.stopPropagation();
      ev.preventDefault();
      globalPlaybackSpeed = speed;
      saveSettings();
      syncAllVideos();
      closeSpeedMenu();
    };

    item.addEventListener('click', selectSpeed, { capture: true });
    item.addEventListener('pointerdown', (ev) => ev.stopPropagation(), { capture: true });
    item.addEventListener('mousedown', (ev) => ev.stopPropagation(), { capture: true });

    menu.appendChild(item);
  });

  // Block event propagation to prevent Instagram from taking actions
  const blockEvents = (ev) => {
    ev.stopPropagation();
  };
  menu.addEventListener('pointerdown', blockEvents);
  menu.addEventListener('mousedown', blockEvents);
  menu.addEventListener('click', blockEvents);

  document.body.appendChild(menu);

  // Position the menu above the scrubber (or near the anchor as fallback)
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

    // Safeguard vertical overflow (if off screen at top, display below)
    if (top < 10) {
      if (useScrubber) {
        const scrubberRect = scrubber.getBoundingClientRect();
        top = scrubberRect.bottom + 8;
      } else if (anchorBtn && anchorBtn.isConnected) {
        const rect = anchorBtn.getBoundingClientRect();
        top = rect.bottom + 8;
      }
    }

    // Keep horizontal boundaries
    if (left < 10) left = 10;
    if (left + menuWidth > window.innerWidth - 10) {
      left = window.innerWidth - menuWidth - 10;
    }

    menu.style.top = `${top}px`;
    menu.style.left = `${left}px`;
  };

  updateMenuPosition();
  // Adjust position in case layout renders with offsetHeight
  setTimeout(updateMenuPosition, 0);
}

// --- ХЕЛПЕР ОПРЕДЕЛЕНИЯ REELS ---
function checkIsReel(video) {
  if (!video) return false;
  const path = window.location.pathname;
  return path.includes('/reels/') || path.includes('/reel/');
}

// --- ХЕЛПЕР ОПРЕДЕЛЕНИЯ STORIES ---
function checkIsStory(video) {
  if (!video) return false;
  const path = window.location.pathname;
  return path.includes('/stories/');
}

// --- ХЕЛПЕР АКТИВНОГО ПЛЕЕРА ---
function isMainPlayer(video) {
  if (!video) return false;

  // Если это сторис - всегда обрабатываем
  if (checkIsStory(video)) return true;

  // Если видео находится внутри открытого модального окна (кликнули по посту) - всегда обрабатываем
  if (video.closest('[role="dialog"]')) return true;

  // Анализируем структуру URL, чтобы определить страницы профилей или рекомендаций
  const path = window.location.pathname;
  const segments = path.split('/').filter(Boolean);
  const firstSegment = segments[0] || '';

  // Определяем, является ли путь детальным просмотром поста/рилса/сторис
  const isDetailView = path.includes('/reel/') || path.includes('/p/') || path.includes('/stories/');

  // Проверяем, является ли страница профилем пользователя (исключая системные пути и детальные просмотры)
  const isProfile = !isDetailView && segments.length > 0 && ![
    'reels', 'reel', 'stories', 'explore', 'direct', 'p'
  ].includes(firstSegment);

  const isExplore = !isDetailView && firstSegment === 'explore';

  // Если мы на странице профиля или Explore, полностью игнорируем фоновые видео-превью
  if (isProfile || isExplore) {
    return false;
  }

  // Если мы на прямой странице поста (/p/...) — всегда обрабатываем
  if (path.includes('/p/')) return true;

  // На стандартных страницах (лента новостей, Reels) обрабатываем только Reels и посты в ленте
  return (
    checkIsReel(video) ||
    video.closest('article')
  );
}

// --- ДИНАМИЧЕСКИЙ ОКРАС ТРЕКА ---
function updateSliderGradient(slider, value) {
  if (!slider) return;
  const pct = value * 100;
  slider.style.background = `linear-gradient(to right, #ffffff 0%, #ffffff ${pct}%, rgba(255, 255, 255, 0.35) ${pct}%, rgba(255, 255, 255, 0.35) 100%)`;
}

// --- ПРОВЕРКА И СИНХРОНИЗАЦИЯ НАТИВНОГО МЬЮТА ---
function isNativeButtonMuted(nativeBtn, video) {
  // Полагаемся на визуальное состояние кнопки (метки и SVG), так как React-состояние часто рассинхронизируется
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

// Полноценная эмуляция событий мыши и сенсора для React-компонентов Instagram
function safeClick(element) {
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

function syncNativeButtonMuteState(video) {
  const nativeBtn = video._nativeMuteBtn || findNativeMuteButton(video);
  if (!nativeBtn) return;

  if (video._ignoreMuteBtnSync || video._isSyncingMute) return;

  const iconShowsMuted = isNativeButtonMuted(nativeBtn, video);

  if (iconShowsMuted !== globalMuted) {
    video._isSyncingMute = true;
    nativeBtn._ignoreClick = true;

    const prevIgnoreVolumechange = video._ignoreVolumechange;
    video._ignoreVolumechange = true;

    safeClick(nativeBtn);

    // Повышено до 30мс для надежного завершения цикла обновления React DOM
    setTimeout(() => {
      nativeBtn._ignoreClick = false;
      video._ignoreVolumechange = prevIgnoreVolumechange;
      video._isSyncingMute = false;
    }, 30);
  }
}

// --- УГОЛ НАКЛОНА СТРЕЛКИ СПИДОМЕТРА ---
function getNeedleRotationForSpeed(speed) {
  if (speed <= 0.25) return -75;
  if (speed <= 0.5) return -45;
  if (speed <= 1.0) return 0;
  if (speed <= 1.25) return 25;
  if (speed <= 1.5) return 50;
  return 75;
}

// Функция принудительного возврата фокуса на контейнер плеера Instagram
function restorePlayerFocus(video) {
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

// --- ПРОВЕРКА НАЛИЧИЯ КНОПКИ СКОРОСТИ В DOM ---
function hasSpeedButtonInDOM(video) {
  // Reels: кнопка скорости в боковой панели
  if (video._speedActionItem && video._speedActionItem.isConnected) return true;
  // Stories: кнопка скорости в шапке
  if (video._storySpeedBtn && video._storySpeedBtn.isConnected) return true;
  // Feed posts: кнопка скорости рядом с мьютом
  if (video._feedSpeedBtn && video._feedSpeedBtn.isConnected) return true;
  return false;
}

// --- СИНХРОНИЗАЦИЯ ГРОМКОСТИ И СКОРОСТИ ---
function syncAllVideos() {
  // Очищаем кэш от удаленных из DOM видео-элементов
  for (const video of activeVideos) {
    if (!video.isConnected) {
      activeVideos.delete(video);
    }
  }

  activeVideos.forEach(video => {
    if (!video.isConnected) return;

    if (video._ignoreVolumechangeTimer) {
      clearTimeout(video._ignoreVolumechangeTimer);
    }

    video._ignoreVolumechange = true;

    if (hasUserInteracted()) {
      const targetVolume = globalMuted ? 0 : Math.pow(globalSliderValue, 2);
      video.volume = targetVolume;
    }

    const sliderContainer = video._sliderContainer;
    if (sliderContainer) {
      const slider = sliderContainer.querySelector('.ig-volume-slider');
      if (slider) {
        slider.value = globalSliderValue;
        updateSliderGradient(slider, globalSliderValue);
      }
    }

    // Выставляем скорость: используем пользовательскую скорость ТОЛЬКО если кнопка физически присутствует в DOM
    const speedBtnPresent = hasSpeedButtonInDOM(video);
    const targetSpeed = speedBtnPresent ? globalPlaybackSpeed : 1.0;

    const originalSetter = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'playbackRate').set;
    if (originalSetter) {
      originalSetter.call(video, targetSpeed);
    } else {
      video.playbackRate = targetSpeed;
    }

    // Обновляем визуальное состояние регулятора скорости (Reels sidebar)
    if (video._speedActionItem) {
      const label = video._speedActionItem.querySelector('.ig-speed-label');
      if (label) label.textContent = `${globalPlaybackSpeed}x`;

      const needle = video._speedActionItem.querySelector('.ig-speed-needle');
      if (needle) {
        needle.style.transform = `rotate(${getNeedleRotationForSpeed(globalPlaybackSpeed)}deg)`;
      }

      const menuItems = video._speedActionItem.querySelectorAll('.ig-speed-menu-item');
      menuItems.forEach(item => {
        const itemSpeed = parseFloat(item.getAttribute('data-speed'));
        if (Math.abs(itemSpeed - globalPlaybackSpeed) < 0.01) {
          item.classList.add('active');
        } else {
          item.classList.remove('active');
        }
      });
    }

    // Обновляем визуальное состояние кнопки скорости в Stories
    if (video._storySpeedBtn && video._storySpeedBtn.isConnected) {
      video._storySpeedBtn.textContent = globalPlaybackSpeed === 1.0 ? '1x' : `${globalPlaybackSpeed}x`;
      video._storySpeedBtn.classList.toggle('ig-speed-active', globalPlaybackSpeed !== 1.0);
    }

    // Обновляем визуальное состояние кнопки скорости в Feed posts
    if (video._feedSpeedBtn && video._feedSpeedBtn.isConnected) {
      video._feedSpeedBtn.textContent = globalPlaybackSpeed === 1.0 ? '1x' : `${globalPlaybackSpeed}x`;
      video._feedSpeedBtn.classList.toggle('ig-speed-active', globalPlaybackSpeed !== 1.0);
    }

    // Обновляем визуальное состояние автопропуска
    if (video._autoskipActionItem) {
      const label = video._autoskipActionItem.querySelector('.ig-control-label');
      if (label) {
        label.textContent = globalAutoSkip ? 'AutoSkip: ON' : 'AutoSkip';
      }
      if (globalAutoSkip) {
        video._autoskipActionItem.classList.add('active');
      } else {
        video._autoskipActionItem.classList.remove('active');
      }
    }

    // Повышено до 30мс для надежного удержания блокировки при высокой нагрузке
    video._ignoreVolumechangeTimer = setTimeout(() => {
      video._ignoreVolumechange = false;
      video._ignoreVolumechangeTimer = null;
    }, 30);
  });
}

// --- ПОИСК ОБЩЕГО ПРЕДКА ---
function findCommonAncestor(el1, el2) {
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

// --- ПРОВЕРКА SVG НА ИКОНКУ ДИНАМИКА ---
function isSpeakerSVG(svg) {
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

// --- ПРОВЕРКА НА СПЕЦИФИЧНУЮ МЕТКУ ЗВУКА СТОРИС ---
function isStoryMuteSVG(svg) {
  if (!svg) return false;
  const label = (svg.getAttribute('aria-label') || svg.getAttribute('title') || '').toLowerCase();
  return label.includes('audio is') || label.includes('звук') || label.includes('audio playing') || label.includes('audio muted');
}

// --- ПОИСК РАССТОЯНИЯ В DOM ---
function getDOMDistanceToAncestor(child, ancestor) {
  let distance = 0;
  let temp = child;
  while (temp && temp !== ancestor) {
    distance++;
    temp = temp.parentElement;
  }
  return distance;
}

// --- ПОИСК ОРИГИНАЛЬНОЙ КНОПКИ ЗВУКА ---
function findNativeMuteButton(video) {
  // Разделяем поиск: для сторис ищем строго внешнюю карточку, включая все возможные контейнеры слайдов Stories
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

  // 1. Ищем строго по специфичным Story-меткам или стандартным путям
  for (const svg of svgs) {
    // КРИТИЧЕСКИЙ ФИЛЬТР: Полностью игнорируем любые иконки внутри нижней панели реакций/ввода (._ac7v)
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

  // 2. Резервный физический поиск: ищем иконку в правой нижней четверти самого видео-элемента
  if (!bestSvg) {
    const rootRect = video.getBoundingClientRect();
    let minDistanceToCorner = Infinity;

    for (const svg of svgs) {
      const rect = svg.getBoundingClientRect();

      // Ограничиваем поиск правой нижней четвертью видео с небольшим допуском вовне
      const inRightHalf = rect.left > rootRect.left + (rootRect.width / 3);
      const inBottomHalf = rect.top > rootRect.top + (rootRect.height / 3);

      // Проверяем, что иконка действительно относится к плееру, а не к боковой панели Reels
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

// --- ПОИСК НАТИВНОЙ КНОПКИ PLAY/PAUSE В СТОРИС ---
function findNativePlayPauseButton(video) {
  const playerContainer = video.closest('section, div[role="dialog"], ._as3a');
  if (!playerContainer) return null;
  const buttons = Array.from(playerContainer.querySelectorAll('button, [role="button"], div[tabindex="0"]'));
  const keywords = ['play', 'pause', 'воспроизвести', 'пауза', 'lecture', 'play/pause'];
  return buttons.find(btn => {
    const label = (btn.getAttribute('aria-label') || btn.getAttribute('title') || '').toLowerCase();
    if (keywords.some(kw => label.includes(kw))) return true;

    const svg = btn.querySelector('svg');
    if (svg) {
      const paths = Array.from(svg.querySelectorAll('path')).map(p => p.getAttribute('d') || '');
      const isPlayOrPause = paths.some(p =>
        p.includes('M6 19h4V5H6v14zm8-14v14h4V5h-4z') ||
        p.includes('M8 5v14l11-7z') ||
        p.includes('M5.5 3') ||
        p.includes('M12 2C6.48 2')
      );
      if (isPlayOrPause) return true;
    }
    return false;
  });
}

// --- УСТАНОВКА КЛИКА ПО ПЛЕЕРУ СТОРИС ---
function setupStoryViewportClick(video) {
  const viewport = video.closest('section, ._as3a') || video.parentElement;
  if (!viewport) return;

  // Привязываем слушатель строго один раз к самому контейнеру карточки, а не к видео
  if (viewport._hasStoryViewportListener) return;
  viewport._hasStoryViewportListener = true;

  const handler = (e) => {
    // Находим активное видео внутри карточки прямо в момент клика
    const activeVideo = viewport.querySelector('video');
    if (!activeVideo) return;

    // Игнорируем любые клики вне физической области карточки сторис (навигационные стрелки по бокам и т.д.)
    if (!isClickInsideElement(e, activeVideo.parentElement || activeVideo)) return;

    // Сначала проверяем клик по кнопке скорости сторис
    const speedBtnEl = e.target.closest('.ig-inline-speed-btn');
    if (speedBtnEl) {
      e.stopPropagation();
      e.preventDefault();
      showSpeedMenu(speedBtnEl, activeVideo);
      return;
    }

    // 1. Проверяем клик по кастомным элементам громкости и скруббера
    const isControlClick = e.target.closest(
      '.ig-volume-slider-container, .ig-video-scrubber-container, .ig-action-item, input[type="range"]'
    );
    if (isControlClick) {
      e.stopPropagation();
      e.preventDefault();
      return;
    }

    // 2. Игнорируем клики по кнопкам управления сторис в шапке
    const isHeaderClick = e.target.closest('header, ._ac7v, button, [role="button"]');
    if (isHeaderClick) return;

    // Предотвращаем нативное перелистывание/паузу от инстаграма
    e.preventDefault();
    e.stopPropagation();

    // 3. Обработка первого размьючивания
    if (!firstUnmuteTriggered) {
      const nativeBtn = activeVideo._nativeMuteBtn || findNativeMuteButton(activeVideo);
      const iconShowsMuted = nativeBtn ? isNativeButtonMuted(nativeBtn, activeVideo) : false;

      if (iconShowsMuted) {
        firstUnmuteTriggered = true;
        lastUserInteractionTime = Date.now();
        globalMuted = false;
        saveSettings();

        if (nativeBtn) {
          safeClick(nativeBtn);
        }
        return;
      } else {
        firstUnmuteTriggered = true;
      }
    }

    // 4. Переключение состояния воспроизведения активного видео
    const playPauseBtn = findNativePlayPauseButton(activeVideo);
    if (playPauseBtn) {
      safeClick(playPauseBtn);
    } else {
      if (activeVideo.paused) {
        activeVideo.play().catch(() => { });
      } else {
        activeVideo.pause();
      }
    }
  };

  viewport.addEventListener('click', handler, { capture: true });
}

// --- УПРАВЛЕНИЕ ПОЗИЦИЕЙ СКРУББЕРА (ОПТИМИЗИРОВАНО) ---
function updateScrubberPosition(video, scrubberContainer) {
  if (!video.isConnected || !scrubberContainer.isConnected) return;

  const rect = video.getBoundingClientRect();
  const parent = scrubberContainer.parentElement;
  const offsetRect = parent.getBoundingClientRect();

  // Кэшируем геометрические параметры для предотвращения Layout Thrashing
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


// --- НАСТРОЙКА СЛУШАТЕЛЕЙ ВИДЕО ---
function setupVideoListeners(video) {
  if (video._hasVolumeChangeListener) return;
  video._hasVolumeChangeListener = true;

  activeVideos.add(video);

  // ГАРАНТИЯ СКОРОСТИ: Принудительный сброс/установка скорости на ключевых этапах инициализации медиа-потока.
  const enforceSpeed = () => {
    // Скорость применяется ТОЛЬКО если кнопка физически присутствует в DOM
    const speedBtnPresent = hasSpeedButtonInDOM(video);
    const targetSpeed = speedBtnPresent ? globalPlaybackSpeed : 1.0;

    const originalSetter = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'playbackRate').set;
    if (originalSetter) {
      originalSetter.call(video, targetSpeed);
    } else {
      video.playbackRate = targetSpeed;
    }

    if (!video._hasDoneSpeedPipelineFlush && !video.paused && video.readyState >= 2) {
      video._hasDoneSpeedPipelineFlush = true;
      const curTime = video.currentTime;
      video.currentTime = curTime > 0 ? curTime : 0.001;
    }
  };

  video.addEventListener('play', enforceSpeed, { passive: true });
  video.addEventListener('playing', enforceSpeed, { passive: true });
  video.addEventListener('loadedmetadata', enforceSpeed, { passive: true });
  video.addEventListener('loadeddata', enforceSpeed, { passive: true });
  video.addEventListener('canplay', enforceSpeed, { passive: true });

  video.addEventListener('volumechange', () => {
    if (video._ignoreVolumechange) return;

    if (video._volumechangeEventTimer) {
      clearTimeout(video._volumechangeEventTimer);
    }

    video._volumechangeEventTimer = setTimeout(() => {
      // Сохраняем громкость, заданную пользователем через нативный интерфейс
      globalSliderValue = Math.sqrt(video.volume);
      globalMuted = video.muted || video.volume === 0;
      saveSettings();

      // Синхронизируем громкость на всех остальных видео
      syncAllVideos();
      video._volumechangeEventTimer = null;
    }, 10);
  });

  video.addEventListener('play', () => {
    if (hasUserInteracted()) {
      video._ignoreVolumechange = true;
      const targetVol = globalMuted ? 0 : Math.pow(globalSliderValue, 2);
      video.volume = targetVol;
      syncNativeButtonMuteState(video);
      setTimeout(() => {
        video._ignoreVolumechange = false;
      }, 10);
    }
  });

  const handleWheel = (e) => {
    if (video.paused) return;
    e.preventDefault();
    e.stopPropagation();

    lastUserInteractionTime = Date.now();

    const delta = e.deltaY < 0 ? 0.05 : -0.05;
    globalSliderValue = Math.max(0, Math.min(1, globalSliderValue + delta));
    globalMuted = globalSliderValue === 0;

    saveSettings();
    syncAllVideos();
    syncNativeButtonMuteState(video);
  };

  if (video._oldHandleWheel) {
    video.removeEventListener('wheel', video._oldHandleWheel, { capture: true });
  }
  video._oldHandleWheel = handleWheel;
  video.addEventListener('wheel', handleWheel, { passive: false, capture: true });
}

// --- ИНЪЕКЦИЯ СКРУББЕРА (ПРОГРЕСС-БАРА) ---
function injectScrubber(video) {
  if (video._hasScrubber) return;
  video._hasScrubber = true;

  video._lastScrubberRect = null; // СБРОС КЭША: гарантирует, что новый элемент сразу получит координаты

  // Монтируем скруббер строго в тот же верхний контейнер, что и рабочий слайдер звука
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

  // Базовые свойства позиционирования (остальное рассчитывается геометрически)
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

  // Первичный расчет координат скруббера по размерам видеоплеера
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

    // Дросселируем обновление времени видео во избежание микрофризов звука/видео
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

  const otherEvents = ['dragstart', 'selectstart'];
  otherEvents.forEach(eventName => {
    scrubberContainer.addEventListener(eventName, (e) => {
      e.stopPropagation();
      e.preventDefault();
    }, { capture: true });
  });
}

// --- ПОИСК БОКОВОЙ ПАНЕЛИ ДЕЙСТВИЙ REELS ---
function findReelsActionBar(video) {
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

// --- ПРИНУДИТЕЛЬНОЕ УДЕРЖАНИЕ СКОРОСТИ ---
function enforcePlaybackRate(video) {
  if (video._playbackRateInterceptorsApplied) return;
  video._playbackRateInterceptorsApplied = true;

  const descriptor = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'playbackRate');
  if (descriptor && descriptor.set) {
    const originalGetter = descriptor.get;
    const originalSetter = descriptor.set;

    Object.defineProperty(video, 'playbackRate', {
      configurable: true,
      get() {
        return originalGetter.call(this);
      },
      set(val) {
        // Форсируем ускорение ТОЛЬКО если кнопка скорости присутствует в DOM
        const speedBtnPresent = hasSpeedButtonInDOM(this);
        if (speedBtnPresent) {
          originalSetter.call(this, globalPlaybackSpeed);
        } else {
          originalSetter.call(this, val);
        }
      }
    });

    // Инициализируем стартовую скорость: только если кнопка уже есть
    const speedBtnPresent = hasSpeedButtonInDOM(video);
    originalSetter.call(video, speedBtnPresent ? globalPlaybackSpeed : 1.0);
  }
}

// --- ИНЪЕКЦИЯ КНОПКИ СКОРОСТИ ДЛЯ STORIES ---
function injectStorySpeedButton(video) {
  if (video._hasStorySpeedBtn) return;
  if (!checkIsStory(video)) return;

  // Ищем шапку сторис: контейнер с кнопками mute/pause/more (⋯)
  const storySection = video.closest('section, ._as3a, ._abag, [role="dialog"]');
  if (!storySection) return;

  // Ищем верхнюю панель с кнопками: обычно это div/header содержащий ряд кнопок
  const header = storySection.querySelector('header');
  const headerButtons = header
    ? header.querySelectorAll('button, [role="button"]')
    : storySection.querySelectorAll('button, [role="button"]');
  if (headerButtons.length === 0) return;

  // Находим последнюю кнопку в верхней части ("⋯" / more), чтобы вставить рядом
  const videoRect = video.getBoundingClientRect();
  let rightmostBtn = null;
  let maxRight = -Infinity;

  for (const btn of headerButtons) {
    // Игнорируем кнопки внутри нижней панели реакций
    if (btn.closest('._ac7v')) continue;
    const rect = btn.getBoundingClientRect();
    
    // Кнопка должна быть в верхней трети видео и горизонтально внутри границ видео
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
  speedBtn.textContent = globalPlaybackSpeed === 1.0 ? '1x' : `${globalPlaybackSpeed}x`;
  if (globalPlaybackSpeed !== 1.0) speedBtn.classList.add('ig-speed-active');
  speedBtn.title = 'Toggle playback speed';

  // Стиль: маленькая кнопка, вписывается в шапку
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

  // Вставляем после последней кнопки в том же контейнере
  const btnParent = rightmostBtn.parentElement;
  if (btnParent) {
    rightmostBtn.insertAdjacentElement('afterend', speedBtn);
  } else {
    video._hasStorySpeedBtn = false;
    return;
  }

  video._storySpeedBtn = speedBtn;
  activeVideos.add(video);
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

// --- ИНЪЕКЦИЯ КНОПКИ СКОРОСТИ ДЛЯ FEED POSTS ---
function injectFeedSpeedButton(video, nativeMuteBtn) {
  if (video._hasFeedSpeedBtn) return;
  if (checkIsReel(video) || checkIsStory(video)) return;

  // Только для видео в article или dialog
  const container = video.closest('article, [role="dialog"]');
  if (!container) return;

  video._hasFeedSpeedBtn = true;

  const speedBtn = document.createElement('div');
  speedBtn.className = 'ig-inline-speed-btn ig-feed-speed-btn';
  speedBtn.textContent = globalPlaybackSpeed === 1.0 ? '1x' : `${globalPlaybackSpeed}x`;
  if (globalPlaybackSpeed !== 1.0) speedBtn.classList.add('ig-speed-active');
  speedBtn.title = 'Toggle playback speed';

  // Стиль: маленькая кнопка рядом с мьютом
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
    // Позиционируем слева от кнопки мьюта
    const muteRect = nativeMuteBtn.getBoundingClientRect();
    const videoRect = video.getBoundingClientRect();

    // Монтируем в общий предок video и muteBtn
    mountParent = findCommonAncestor(video, nativeMuteBtn) || video.parentElement;
    const mountParentStyle = window.getComputedStyle(mountParent);
    if (mountParentStyle.position === 'static') {
      mountParent.style.position = 'relative';
    }

    mountParent.classList.add('ig-speed-parent');
    mountParent.appendChild(speedBtn);

    // Рассчитываем позицию: слева от кнопки мьюта
    updateFeedSpeedPos = () => {
      if (!speedBtn.isConnected || !nativeMuteBtn.isConnected) return;
      const mR = nativeMuteBtn.getBoundingClientRect();
      const pR = mountParent.getBoundingClientRect();
      speedBtn.style.bottom = `${pR.bottom - mR.bottom + (mR.height - 28) / 2}px`;
      speedBtn.style.right = `${pR.right - mR.left + 4}px`;
    };
  } else {
    // Фоллбэк: позиционируем в правом нижнем углу видео
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
  activeVideos.add(video);
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

// --- ИНЪЕКЦИЯ РЕГУЛЯТОРА СКОРОСТИ И АВТОСКИПА ---
function injectExtraControls(video, cachedActionBar) {
  const isReel = checkIsReel(video);

  if (!isReel) {
    // Если это не Reels — сбрасываем скорость на 1x только если нет нашей кнопки
    if (!hasSpeedButtonInDOM(video) && video.playbackRate !== 1.0) {
      video.playbackRate = 1.0;
    }
    return;
  }

  if (video._hasExtraControls) return;
  video._hasExtraControls = true; // Помечаем как обработанное

  activeVideos.add(video);
  enforcePlaybackRate(video);

  // Используем переданный кэшированный action bar или ищем новый
  const actionBar = cachedActionBar || findReelsActionBar(video);

  // 1. Создаем элемент регулировки скорости
  const speedItem = document.createElement('div');
  speedItem.className = 'ig-action-item ig-speed-item';

  const initialRotation = getNeedleRotationForSpeed(globalPlaybackSpeed);

  speedItem.innerHTML = `
    <div class="ig-control-btn ig-speed-btn" title="Speed">
      <svg class="ig-speed-svg" viewBox="0 0 24 24">
        <path d="M 4 15 A 8 8 0 0 1 20 15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
        <path d="M 6 13 A 6 6 0 0 1 18 13" fill="none" stroke="currentColor" stroke-width="1" stroke-dasharray="2,2" opacity="0.6" />
        <line x1="12" y1="7" x2="12" y2="8" stroke="currentColor" stroke-width="1.5"/>
        <line x1="5" y1="12" x2="6.5" y2="12.5" stroke="currentColor" stroke-width="1.5"/>
        <line x1="19" y1="12" x2="17.5" y2="12.5" stroke="currentColor" stroke-width="1.5"/>
        <circle cx="12" cy="15" r="2.5" fill="currentColor" />
        <line class="ig-speed-needle" x1="12" y1="15" x2="12" y2="9" stroke="currentColor" stroke-width="2" stroke-linecap="round" style="transform: rotate(${initialRotation}deg);" />
      </svg>
      <!-- Dropdown Menu -->
      <div class="ig-reels-speed-menu">
        <div class="ig-reels-speed-menu-item ${Math.abs(globalPlaybackSpeed - 0.25) < 0.01 ? 'active' : ''}" data-speed="0.25">0.25x</div>
        <div class="ig-reels-speed-menu-item ${Math.abs(globalPlaybackSpeed - 0.5) < 0.01 ? 'active' : ''}" data-speed="0.5">0.5x</div>
        <div class="ig-reels-speed-menu-item ${Math.abs(globalPlaybackSpeed - 0.75) < 0.01 ? 'active' : ''}" data-speed="0.75">0.75x</div>
        <div class="ig-reels-speed-menu-item ${Math.abs(globalPlaybackSpeed - 1.0) < 0.01 ? 'active' : ''}" data-speed="1">1x</div>
        <div class="ig-reels-speed-menu-item ${Math.abs(globalPlaybackSpeed - 1.25) < 0.01 ? 'active' : ''}" data-speed="1.25">1.25x</div>
        <div class="ig-reels-speed-menu-item ${Math.abs(globalPlaybackSpeed - 1.5) < 0.01 ? 'active' : ''}" data-speed="1.5">1.5x</div>
        <div class="ig-reels-speed-menu-item ${Math.abs(globalPlaybackSpeed - 1.75) < 0.01 ? 'active' : ''}" data-speed="1.75">1.75x</div>
        <div class="ig-reels-speed-menu-item ${Math.abs(globalPlaybackSpeed - 2.0) < 0.01 ? 'active' : ''}" data-speed="2">2x</div>
        <div class="ig-reels-speed-menu-item ${Math.abs(globalPlaybackSpeed - 2.5) < 0.01 ? 'active' : ''}" data-speed="2.5">2.5x</div>
        <div class="ig-reels-speed-menu-item ${Math.abs(globalPlaybackSpeed - 3.0) < 0.01 ? 'active' : ''}" data-speed="3">3x</div>
      </div>
    </div>
    <span class="ig-control-label ig-speed-label">${globalPlaybackSpeed}x</span>
  `;

  // 2. Создаем элемент автопропуска
  const autoskipItem = document.createElement('div');
  autoskipItem.className = 'ig-action-item ig-autoskip-item';
  if (globalAutoSkip) {
    autoskipItem.classList.add('active');
  }

  autoskipItem.innerHTML = `
    <div class="ig-control-btn ig-autoskip-btn" title="Auto-skip to next video">
      <svg class="ig-autoskip-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" style="width: 20px; height: 20px;">
        <polyline points="7 13 12 18 17 13"></polyline>
        <polyline points="7 6 12 11 17 6"></polyline>
      </svg>
    </div>
    <span class="ig-control-label">${globalAutoSkip ? 'AutoSkip: ON' : 'AutoSkip'}</span>
  `;

  // Если боковая панель еще не загрузилась — пропускаем инъекцию и ждем следующего сканирования плеера,
  // чтобы кнопки появились строго в нативном боковом меню и не перекрывали само видео.
  if (!actionBar) {
    video._hasExtraControls = false; // Разрешаем повторную попытку при следующем сканировании
    return;
  }

  actionBar.insertBefore(autoskipItem, actionBar.firstChild);
  actionBar.insertBefore(speedItem, autoskipItem);

  video._speedActionItem = speedItem;
  video._autoskipActionItem = autoskipItem;
  video._floatingControlsContainer = null;

  const speedBtn = speedItem.querySelector('.ig-speed-btn');
  const speedMenu = speedItem.querySelector('.ig-reels-speed-menu');

  let menuTimer = null;
  let isOverSpeedArea = false;

  const markEnter = () => {
    isOverSpeedArea = true;
    clearTimeout(menuTimer);
    speedMenu.classList.add('show');
  };

  const markLeave = () => {
    isOverSpeedArea = false;
    clearTimeout(menuTimer);
    menuTimer = setTimeout(() => {
      if (!isOverSpeedArea) {
        speedMenu.classList.remove('show');
      }
    }, 250);
  };

  speedBtn.addEventListener('mouseenter', markEnter);
  speedBtn.addEventListener('mouseleave', markLeave);
  speedMenu.addEventListener('mouseenter', markEnter);
  speedMenu.addEventListener('mouseleave', markLeave);

  const menuItems = speedItem.querySelectorAll('.ig-reels-speed-menu-item');
  menuItems.forEach(item => {
    const selectSpeed = (e) => {
      e.stopPropagation();
      e.preventDefault();
      const speed = parseFloat(item.getAttribute('data-speed'));
      globalPlaybackSpeed = speed;
      saveSettings();
      syncAllVideos();
      
      // Обновляем активный класс в меню
      menuItems.forEach(i => i.classList.remove('active'));
      item.classList.add('active');
    };

    item.addEventListener('mousedown', selectSpeed, { capture: true });
    item.addEventListener('pointerdown', selectSpeed, { capture: true });
    item.addEventListener('click', selectSpeed, { capture: true });
  });

  const autoskipBtn = autoskipItem.querySelector('.ig-autoskip-btn');

  const toggleAutoSkip = (e) => {
    e.stopPropagation();
    e.preventDefault();

    globalAutoSkip = !globalAutoSkip;

    // Мгновенный сброс кулдаунов и форсированный пропуск
    if (globalAutoSkip) {
      lastAutoSkipTime = 0;
      activeVideos.forEach(v => {
        v._autoSkipTriggered = false;

        const duration = v.duration || 0;
        const currentTime = v.currentTime || 0;
        const isNearEnd = duration > 0 && (duration - currentTime <= 0.5);

        if (v.isConnected && (v.ended || isNearEnd)) {
          if (typeof v._oldHandleVideoEnded === 'function') {
            v._oldHandleVideoEnded();
          }
        }
      });
    }

    saveSettings();
    syncAllVideos();

    // Принудительно возвращаем фокус на плеер, чтобы Instagram принимал события
    restorePlayerFocus(video);
  };

  // Блокируем лишние срабатывания от mousedown и pointerdown, оставляя только чистый click
  const blockIGInterference = (e) => {
    e.stopPropagation();
  };

  autoskipBtn.addEventListener('mousedown', blockIGInterference, { capture: true });
  autoskipBtn.addEventListener('pointerdown', blockIGInterference, { capture: true });
  autoskipBtn.addEventListener('click', toggleAutoSkip, { capture: true });

  // Автоматический пропуск по окончании видео
  const handleVideoEnded = () => {
    if (!globalAutoSkip) return;

    // БЛОКИРОВКА ПРОПУСКА: Если пользователь пишет комментарий или сообщение
    if (document.activeElement) {
      const tag = document.activeElement.tagName.toLowerCase();
      const isEditable = document.activeElement.hasAttribute('contenteditable') ||
        document.activeElement.getAttribute('role') === 'textbox';
      if (tag === 'input' || tag === 'textarea' || isEditable) {
        // Пользователь занят набором текста, откладываем пропуск на 5 секунд
        if (video._autoSkipTriggered) return;
        video._autoSkipTriggered = true;

        const preservedSrc = video.currentSrc; // Запоминаем источник, чтобы проверить актуальность позже

        setTimeout(() => {
          video._autoSkipTriggered = false;
          // Проверяем, что видео все еще подключено к DOM, источник не изменился и оно действительно завершено
          if (video.isConnected && video.currentSrc === preservedSrc && video.ended) {
            handleVideoEnded();
          }
        }, 5000);
        return;
      }
    }

    const now = Date.now();
    // Сократили кулдаун до 1 секунды для большей отзывчивости
    if (now - lastAutoSkipTime < 1000) return;
    if (video._autoSkipTriggered) return;

    lastAutoSkipTime = now;
    video._autoSkipTriggered = true;
    setTimeout(() => {
      video._autoSkipTriggered = false;
    }, 1000);

    const isReelsPage = (window.location.pathname.includes('/reels/') || window.location.pathname.includes('/reel/')) || !!video.closest('.x17505xr, .x10b77sg');

    const triggerArrowDown = () => {
      // Сначала возвращаем фокус на плеер
      restorePlayerFocus(video);

      const keyEventInit = {
        key: 'ArrowDown',
        keyCode: 40,
        code: 'ArrowDown',
        which: 40,
        bubbles: true,
        cancelable: true,
        view: window
      };

      const targets = [];

      // 1. Текущий активный элемент (наш плеер после фокуса)
      if (document.activeElement) targets.push(document.activeElement);

      // 2. Контейнер видео плеера
      const videoWrapper = video.closest('.x17505xr, .x10b77sg') || video.parentElement;
      if (videoWrapper && !targets.includes(videoWrapper)) targets.push(videoWrapper);

      // 3. Тело документа и сам документ
      if (!targets.includes(document.body)) targets.push(document.body);
      targets.push(document);

      // Рассылаем события по всем целям, чтобы React гарантированно перехватил их
      targets.forEach(t => {
        try {
          t.dispatchEvent(new KeyboardEvent('keydown', keyEventInit));
          t.dispatchEvent(new KeyboardEvent('keyup', keyEventInit));
        } catch (err) {
          console.debug("[IG Volume] Dispatch failed on target", t, err);
        }
      });

      // Дублируем событие на уровне глобального окна
      window.dispatchEvent(new KeyboardEvent('keydown', keyEventInit));
      window.dispatchEvent(new KeyboardEvent('keyup', keyEventInit));
    };

    if (isReelsPage) {
      triggerArrowDown();
    } else {
      const reelContainer = video.closest([
        'div[style*="aspect-ratio"]',
        'article',
        '.x17505xr',
        '.x10b77sg',
        '[data-media-id]'
      ].join(', '));

      let nextReel = null;
      if (reelContainer) {
        let next = reelContainer.nextElementSibling;
        while (next) {
          if (next.querySelector('video') || next.matches('article') || next.querySelector('[role="button"]')) {
            nextReel = next;
            break;
          }
          next = next.nextElementSibling;
        }
      }

      if (nextReel) {
        nextReel.scrollIntoView({ behavior: 'smooth', block: 'start' });
      } else {
        let parent = video.parentElement;
        let scrollContainer = null;
        while (parent && parent !== document.documentElement) {
          const style = window.getComputedStyle(parent);
          if (style.overflowY === 'auto' || style.overflowY === 'scroll') {
            scrollContainer = parent;
            break;
          }
          parent = parent.parentElement;
        }

        if (scrollContainer) {
          scrollContainer.scrollBy({ top: window.innerHeight, behavior: 'smooth' });
        } else {
          window.scrollBy({ top: window.innerHeight, behavior: 'smooth' });
        }
      }
    }
  };

  if (video._oldHandleVideoEnded) {
    video.removeEventListener('ended', video._oldHandleVideoEnded);
  }
  if (video._oldHandleTimeUpdateForSkip) {
    video.removeEventListener('timeupdate', video._oldHandleTimeUpdateForSkip);
  }
  if (video._oldHandlePlayRate) {
    video.removeEventListener('play', video._oldHandlePlayRate);
    video.removeEventListener('playing', video._oldHandlePlayRate);
  }
  if (video._oldRateChangeHandler) {
    video.removeEventListener('ratechange', video._oldRateChangeHandler);
  }

  video._oldHandleVideoEnded = handleVideoEnded;
  video.addEventListener('ended', handleVideoEnded);

  // Опережающий тайм-апдейт за 0.25 секунды до конца для плавного перелистывания
  const handleTimeUpdateForSkip = () => {
    // Сократили кулдаун проверки до 1 секунды (1000мс)
    if (!globalAutoSkip || video.paused || video._autoSkipTriggered || (Date.now() - lastAutoSkipTime < 1000)) return;
    const duration = video.duration;
    const currentTime = video.currentTime;
    if (duration > 0 && (duration - currentTime <= 0.25)) {
      handleVideoEnded();
    }
  };
  video._oldHandleTimeUpdateForSkip = handleTimeUpdateForSkip;
  video.addEventListener('timeupdate', handleTimeUpdateForSkip);

  const handlePlayRateEnforcement = () => {
    if (video.playbackRate !== globalPlaybackSpeed) {
      video.playbackRate = globalPlaybackSpeed;
    }
  };
  video._oldHandlePlayRate = handlePlayRateEnforcement;
  video.addEventListener('play', handlePlayRateEnforcement);
  video.addEventListener('playing', handlePlayRateEnforcement);

  const rateChangeHandler = () => {
    if (video._isSyncingSpeed) return;
    if (video.playbackRate !== globalPlaybackSpeed) {
      video._isSyncingSpeed = true;
      video.playbackRate = globalPlaybackSpeed;
      // Даем микропаузу для завершения внутренней обработки браузера
      setTimeout(() => {
        video._isSyncingSpeed = false;
      }, 0);
    }
  };
  video._oldRateChangeHandler = rateChangeHandler;
  video.addEventListener('ratechange', rateChangeHandler);
}


// --- ДИНАМИЧЕСКОЕ УСТРАНЕНИЕ МЕШАЮЩИХ ОВЕРЛЕЕВ ---
function clearOverlayInterference(video) {
  if (!video || !video.isConnected) return;

  // Защищаем сетку постов профиля/поиска: запускаем очистку только для полноценных Reels, Stories, постов в ленте или модальных окон
  const isFullPlayer = checkIsReel(video) || checkIsStory(video) || video.closest('article') || video.closest('[role="dialog"]');
  if (!isFullPlayer) return;

  // Строго ограничиваем подъем по DOM-дереву локальным контейнером плеера, 
  // чтобы предотвратить отключение pointer-events у глобальных разделов страницы
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

        // Проверяем, содержит ли элемент кнопку закрытия/выхода/назад (Close / X / Back)
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

        // Если элемент абсолютный, не кастомный И стиль pointer-events еще НЕ равен 'none'
        if (isAbsoluteOrFixed && !isCustomElement && style.pointerEvents !== 'none') {
          sibling.style.setProperty('pointer-events', 'none', 'important');
        }
      }
    }

    current = parent;
  }
}

// --- MUTATION OBSERVER ---
function scanAndInject() {
  // Самоликвидация: если расширение перезагружено, останавливаем старые фоновые интервалы и очищаем стили
  if (isScriptOrphaned()) {
    if (typeof globalScanInterval !== 'undefined') clearInterval(globalScanInterval);
    if (typeof observer !== 'undefined') observer.disconnect();
    const style = document.getElementById('ig-volume-controller-core-styles');
    if (style) style.remove();
    return;
  }

  // Очистка любых старых слайдеров, оставшихся в DOM
  document.querySelectorAll('.ig-volume-slider-container').forEach(el => el.remove());

  // Сбрасываем флаг первого клика для размьюта при переходе между разделами (например, профиль -> рилс)
  if (lastGlobalPath !== window.location.pathname) {
    lastGlobalPath = window.location.pathname;
    firstUnmuteTriggered = false;
  }

  document.querySelectorAll('video').forEach(video => {
    // Игнорируем превью-видео в сетках профиля, поиска и раздела рекомендаций
    if (!isMainPlayer(video)) {
      return;
    }

    // Вешаем динамическую очистку мешающих оверлеев Instagram вокруг video
    clearOverlayInterference(video);

    // 1. Вешаем ультра-быстрые триггеры инициализации на любые изменения плеера
    if (!video._hasPlayScanListener) {
      video._hasPlayScanListener = true;
      video.addEventListener('play', triggerScan);
      video.addEventListener('playing', triggerScan);
      // Срабатывает один раз при первом сдвиге кадров видео для обхода задержек предзагрузки
      video.addEventListener('timeupdate', triggerScan, { once: true });
    }

    // Инициализация клика/паузы для сторис (исключая область скруббера)
    if (checkIsStory(video)) {
      setupStoryViewportClick(video);
    }

    // 2. Игнорируем отключенные или скрытые видео без вызова тяжелых методов геометрии
    if (!video.isConnected || (video.offsetWidth === 0 && video.offsetHeight === 0)) {
      return;
    }

    // Если изменился источник видео ИЛИ путь URL (переход на Reels), полностью сбрасываем и пересоздаем элементы
    const pathChanged = video._lastPath !== window.location.pathname;
    const srcChanged = video._lastSrc !== video.currentSrc;

    if (srcChanged || pathChanged) {
      video._lastSrc = video.currentSrc;
      video._lastPath = window.location.pathname;
      video._autoSkipTriggered = false; // Сбрасываем блокировку автопропуска для нового видео
      video._hasDoneSpeedPipelineFlush = false; // Сбрасываем флаг аппаратного обновления декодера Chromium
      video._hasStoryViewportListener = false; // Сбрасываем флаг кликов для новой карточки сторис
      video._lastScrubberRect = null; // СБРОС КЭША: обновляем геометрическую позицию скруббера для нового видео

      // Освобождаем старый обработчик прокрутки колесика во избежание утечки памяти
      if (video._oldHandleWheel) {
        video.removeEventListener('wheel', video._oldHandleWheel, { capture: true });
        video._oldHandleWheel = null;
      }

      // Восстанавливаем оригинальный дескриптор прототипа playbackRate
      if (video._playbackRateInterceptorsApplied) {
        const proto = HTMLMediaElement.prototype;
        const desc = Object.getOwnPropertyDescriptor(proto, 'playbackRate');
        if (desc) {
          Object.defineProperty(video, 'playbackRate', desc);
        } else {
          delete video.playbackRate;
        }
        video._playbackRateInterceptorsApplied = false;
      }

      // Принудительно выставляем стандартную аппаратную скорость 1.0 через нативный прототип
      const originalSetter = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'playbackRate').set;
      if (originalSetter) {
        originalSetter.call(video, 1.0);
      } else {
        video.playbackRate = 1.0;
      }

      if (video._scrubberContainer) {
        video._scrubberContainer.remove();
        video._scrubberContainer = null;
      }
      if (video._sliderContainer) {
        video._sliderContainer.remove();
        video._sliderContainer = null;
      }
      if (video._speedActionItem) {
        video._speedActionItem.remove();
        video._speedActionItem = null;
      }
      if (video._autoskipActionItem) {
        video._autoskipActionItem.remove();
        video._autoskipActionItem = null;
      }
      if (video._floatingControlsContainer) {
        video._floatingControlsContainer.remove();
        video._floatingControlsContainer = null;
      }
      if (video._storySpeedBtn) {
        video._storySpeedBtn.remove();
        video._storySpeedBtn = null;
      }
      if (video._feedSpeedBtn) {
        video._feedSpeedBtn.remove();
        video._feedSpeedBtn = null;
      }

      video._hasScrubber = false;
      video._hasExtraControls = false;
      video._hasStorySpeedBtn = false;
      video._hasFeedSpeedBtn = false;

      // Отписываемся от старых слушателей Reels-панели во избежание их утечки на Homepage
      if (video._oldHandleVideoEnded) {
        video.removeEventListener('ended', video._oldHandleVideoEnded);
        video._oldHandleVideoEnded = null;
      }
      if (video._oldHandleTimeUpdateForSkip) {
        video.removeEventListener('timeupdate', video._oldHandleTimeUpdateForSkip);
        video._oldHandleTimeUpdateForSkip = null;
      }
      if (video._oldHandlePlayRate) {
        video.removeEventListener('play', video._oldHandlePlayRate);
        video.removeEventListener('playing', video._oldHandlePlayRate);
        video._oldHandlePlayRate = null;
      }
      if (video._oldRateChangeHandler) {
        video.removeEventListener('ratechange', video._oldRateChangeHandler);
        video._oldRateChangeHandler = null;
      }

      if (video._nativeMuteBtn) {
        video._nativeMuteBtn = null;
      }
      if (video._cachedActionBar) {
        video._cachedActionBar = null;
      }
    }

    // Настраиваем слушатели громкости, колесика мыши и скорости на самом видео
    setupVideoListeners(video);

    // Получаем текущий контейнер плеера для первого клика и валидации
    const playerContainer = video.closest('section, [role="dialog"], article, .x17505xr, .x10b77sg') || video.parentElement;

    // Изолированный перехват первого клика строго на уровне локального контейнера плеера
    if (playerContainer && !playerContainer._hasFirstClickUnmuteListener) {
      playerContainer._hasFirstClickUnmuteListener = true;
      playerContainer.addEventListener('click', (e) => {
        const activeVideo = playerContainer.querySelector('video');
        if (!activeVideo) return;

        // В сторис игнорируем клики вне физической области карточки (стрелки навигации по бокам, закрытие и т.д.)
        if (checkIsStory(activeVideo) && !isClickInsideElement(e, activeVideo.parentElement || activeVideo)) return;

        const nativeBtn = activeVideo._nativeMuteBtn || findNativeMuteButton(activeVideo);
        const actionBar = activeVideo._cachedActionBar || findReelsActionBar(activeVideo);

        // Проверяем, совершен ли клик по элементам управления или нативным кнопкам (навигация, закрытие и т.д.)
        const isControlClick =
          (nativeBtn && nativeBtn.parentElement && nativeBtn.parentElement.contains(e.target)) ||
          (actionBar && actionBar.contains(e.target)) ||
          e.target.closest('.ig-volume-slider-container, .ig-video-scrubber-container, .ig-action-item, .ig-inline-speed-btn, .ig-speed-menu, .ig-reels-speed-menu, input[type="range"]');

        // Пропускаем клики по любым нативным кнопкам/ссылкам (навигация сторис, закрытие, share и т.д.)
        const isNativeButtonClick = e.target.closest('button, [role="button"], a[href]');
        const isOnMuteBtn = nativeBtn && (nativeBtn === e.target || nativeBtn.contains(e.target));

        if (isControlClick) return;
        if (isNativeButtonClick && !isOnMuteBtn) return;

        if (!firstUnmuteTriggered) {
          const iconShowsMuted = nativeBtn ? isNativeButtonMuted(nativeBtn, activeVideo) : false;

          if (iconShowsMuted) {
            e.preventDefault();
            e.stopPropagation(); // Блокируем нативную паузу для первого разблокирования звука

            firstUnmuteTriggered = true;
            lastUserInteractionTime = Date.now();
            globalMuted = false;
            saveSettings();

            if (nativeBtn) {
              safeClick(nativeBtn); // Активируем звук
            }
          } else {
            firstUnmuteTriggered = true;
          }
        }
      }, { capture: true });
    }

    // Оптимизация: берем кнопку из кэша, если она все еще валидна, подключена к DOM и находится в текущем контейнере
    let currentBtn = video._nativeMuteBtn;
    if (!currentBtn || !currentBtn.isConnected || !playerContainer || !playerContainer.contains(currentBtn)) {
      currentBtn = findNativeMuteButton(video);
      if (currentBtn) {
        video._nativeMuteBtn = currentBtn;
      }
    }

    if (currentBtn) {
      // Вешаем обработчик клика на нативную кнопку звука для сохранения настроек
      if (currentBtn._oldClickHandler) {
        currentBtn.removeEventListener('click', currentBtn._oldClickHandler, { capture: true });
      }

      const clickHandler = () => {
        if (currentBtn._ignoreClick) return;
        lastUserInteractionTime = Date.now();

        video._ignoreMuteBtnSync = true;
        setTimeout(() => {
          video._ignoreMuteBtnSync = false;
        }, 10);

        const iconShowsMuted = isNativeButtonMuted(currentBtn, video);
        globalMuted = !iconShowsMuted;

        saveSettings();
        syncAllVideos();
      };

      currentBtn._oldClickHandler = clickHandler;
      currentBtn.addEventListener('click', clickHandler, { capture: true, passive: true });
    }

    // Определяем ожидаемый родительский контейнер для скруббера (работает даже при отсутствии native mute button)
    const expectedParent = (currentBtn ? findCommonAncestor(video, currentBtn) : null) || video.parentElement;

    // Внедряем скруббер (перемотку) в тот же верхний контейнер
    if (!video._hasScrubber || !video._scrubberContainer || !video._scrubberContainer.isConnected || video._scrubberContainer.parentElement !== expectedParent) {
      if (video._scrubberContainer) {
        video._scrubberContainer.remove();
        video._scrubberContainer = null;
      }
      video._hasScrubber = false;
      injectScrubber(video);
    } else {
      // Обновляем геометрическую позицию и ширину скруббера под размеры видео
      updateScrubberPosition(video, video._scrubberContainer);

      // ГАРАНТИЯ СЛОЕВ: Удерживаем скруббер последним элементом, чтобы он всегда принимал ховер и клики
      const parent = video._scrubberContainer.parentElement;
      if (parent && parent.lastElementChild !== video._scrubberContainer) {
        parent.appendChild(video._scrubberContainer);
      }
    }

    // Оптимизация: берем Reels Action Bar из кэша, если он валиден и принадлежит текущему плееру
    let actionBar = video._cachedActionBar;
    if (!actionBar || !actionBar.isConnected || !playerContainer || !playerContainer.contains(actionBar)) {
      actionBar = findReelsActionBar(video);
      if (actionBar) {
        video._cachedActionBar = actionBar;
      }
    }

    // Стабильное создание кнопок скорости: пересоздаем только если они физически отключены от DOM или если action bar изменился
    let hasExtraControlsConnected = video._hasExtraControls &&
      video._speedActionItem && video._speedActionItem.isConnected &&
      video._autoskipActionItem && video._autoskipActionItem.isConnected &&
      (!actionBar || (video._speedActionItem.parentElement === actionBar && video._autoskipActionItem.parentElement === actionBar));

    if (!hasExtraControlsConnected) {
      if (video._speedActionItem) video._speedActionItem.remove();
      if (video._autoskipActionItem) video._autoskipActionItem.remove();
      if (video._floatingControlsContainer) video._floatingControlsContainer.remove();
      video._hasExtraControls = false;
      injectExtraControls(video, actionBar); // Передаем кэшированный action bar
    }

    // --- ИНЪЕКЦИЯ КНОПКИ СКОРОСТИ ДЛЯ STORIES ---
    if (checkIsStory(video)) {
      // Проверяем валидность существующей кнопки
      if (video._storySpeedBtn && !video._storySpeedBtn.isConnected) {
        video._storySpeedBtn = null;
        video._hasStorySpeedBtn = false;
      }
      if (!video._hasStorySpeedBtn) {
        injectStorySpeedButton(video);
      }
    }

    // --- ИНЪЕКЦИЯ КНОПКИ СКОРОСТИ ДЛЯ FEED POSTS (И DIRECT POST PAGES) ---
    const isFeedPost = !checkIsReel(video) && !checkIsStory(video);
    if (isFeedPost) {
      // Проверяем валидность существующей кнопки
      if (video._feedSpeedBtn && !video._feedSpeedBtn.isConnected) {
        video._feedSpeedBtn = null;
        video._hasFeedSpeedBtn = false;
      }
      if (!video._hasFeedSpeedBtn) {
        injectFeedSpeedButton(video, currentBtn);
      } else if (video._updateFeedSpeedPos) {
        // Обновляем позицию при каждом сканировании
        video._updateFeedSpeedPos();
      }
    }

    // Если нет кнопки скорости — удаляем интерцептор и сбрасываем на 1.0
    const isReel = checkIsReel(video);
    if (!isReel && !hasSpeedButtonInDOM(video)) {
      if (video.hasOwnProperty('playbackRate') || 'playbackRate' in video) {
        delete video.playbackRate;
      }
      video._playbackRateInterceptorsApplied = false;

      const originalSetter = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'playbackRate').set;
      if (originalSetter) {
        originalSetter.call(video, 1.0);
      } else {
        video.playbackRate = 1.0;
      }
    }
  });
}

// Быстрый дебаунсинг сканирования для моментального отклика
let scanTimeout = null;
function triggerScan() {
  if (scanTimeout) clearTimeout(scanTimeout);
  scanTimeout = setTimeout(scanAndInject, 30); // 30мс на объединение запросов
}

const observer = new MutationObserver((mutations) => {
  let shouldScan = false;

  for (const mutation of mutations) {
    for (const node of mutation.addedNodes) {
      if (node.nodeType === Node.ELEMENT_NODE) {
        // Сканируем DOM только если добавился тег видео, кнопка или контейнер, содержащий их
        const tagName = node.tagName;
        if (tagName === 'VIDEO' || tagName === 'BUTTON' || node.querySelector('video, button, [role="button"]')) {
          shouldScan = true;
          break;
        }
      }
    }
    if (shouldScan) break;
  }

  if (shouldScan) {
    triggerScan();
  }
});
observer.observe(document.body, { childList: true, subtree: true });

// Перехват pushState и replaceState для моментальной реакции на SPA-переходы
const originalPushState = history.pushState;
history.pushState = function (...args) {
  originalPushState.apply(this, args);
  triggerScan();
};
const originalReplaceState = history.replaceState;
history.replaceState = function (...args) {
  originalReplaceState.apply(this, args);
  triggerScan();
};

// Глобальные слушатели навигации для моментальной реакции на SPA-переходы
window.addEventListener('popstate', triggerScan, { passive: true });

// Однократный запуск и установка одного интервала сканирования
scanAndInject();
globalScanInterval = setInterval(triggerScan, 300);

// --- ГЛОБАЛЬНЫЙ СЛУШАТЕЛЬ КЛАВИШ ---
document.addEventListener('keydown', (e) => {
  const key = e.key.toLowerCase();
  if (['m', 'arrowup', 'arrowdown'].includes(key)) {
    lastUserInteractionTime = Date.now();
  }
}, { capture: true, passive: true });