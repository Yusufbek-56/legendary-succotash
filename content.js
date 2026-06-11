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
  try {
    return typeof chrome === 'undefined' || !chrome.runtime?.id;
  } catch (e) {
    return true;
  }
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

    // Выставляем скорость воспроизведения: для Reels — пользовательскую, для обычных видео — строго 1x
    const isVideoReel = checkIsReel(video);
    const targetSpeed = isVideoReel ? globalPlaybackSpeed : 1.0;

    const originalSetter = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'playbackRate').set;
    if (originalSetter) {
      originalSetter.call(video, targetSpeed);
    } else {
      video.playbackRate = targetSpeed;
    }

    // Обновляем визуальное состояние регулятора скорости
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

// --- УПРАВЛЕНИЕ ПОЗИЦИЕЙ СЛАЙДЕРА ---
function updateSliderPosition(video, nativeBtn, sliderContainer) {
  if (!nativeBtn.isConnected || !sliderContainer.isConnected) return;

  const rect = nativeBtn.getBoundingClientRect();

  // Кэширование позиции кнопки для предотвращения Forced Synchronous Reflow
  const lastRect = video._lastBtnRect;
  if (lastRect &&
    Math.abs(lastRect.top - rect.top) < 0.5 &&
    Math.abs(lastRect.left - rect.left) < 0.5 &&
    Math.abs(lastRect.width - rect.width) < 0.5 &&
    Math.abs(lastRect.height - rect.height) < 0.5) {
    return;
  }
  video._lastBtnRect = rect;

  const playerRect = video.getBoundingClientRect();

  const nativeBtnCenterX = rect.left + rect.width / 2;
  const playerCenterX = playerRect.left + playerRect.width / 2;
  const isLeftAligned = nativeBtnCenterX < playerCenterX;

  const btnStyle = window.getComputedStyle(nativeBtn);
  if (btnStyle.position === 'static') {
    nativeBtn.style.position = 'relative';
  }
  nativeBtn.style.zIndex = '1000001';

  const height = Math.max(rect.height, 28);
  sliderContainer.style.height = `${height}px`;
  sliderContainer.style.borderRadius = `${height / 2}px`;

  const container = sliderContainer.parentElement || video.parentElement || document.body;
  const offsetRect = container.getBoundingClientRect();
  const style = window.getComputedStyle(container);
  const borderTop = parseFloat(style.borderTopWidth) || 0;
  const borderLeft = parseFloat(style.borderLeftWidth) || 0;
  const borderRight = parseFloat(style.borderRightWidth) || 0;

  const top = rect.top - offsetRect.top - borderTop + (rect.height - height) / 2;
  sliderContainer.style.top = `${top}px`;

  const overlap = rect.width / 4;

  if (isLeftAligned) {
    const left = rect.right - offsetRect.left - borderLeft - overlap - 3;
    sliderContainer.style.left = `${left}px`;
    sliderContainer.style.right = 'auto';
    sliderContainer.classList.add('ig-left-aligned');
    sliderContainer.classList.remove('ig-right-aligned');
  } else {
    const right = offsetRect.right - borderRight - rect.left - overlap + 3;
    sliderContainer.style.right = `${right}px`;
    sliderContainer.style.left = 'auto';
    sliderContainer.classList.add('ig-right-aligned');
    sliderContainer.classList.remove('ig-left-aligned');
  }
}

// --- ИНЪЕКЦИЯ СЛАЙДЕРА ---
function injectSliderNextTo(video, nativeBtn) {
  // Проверяем наличие слайдера напрямую по его связи с текущим видео и кнопкой в DOM
  if (video._sliderContainer && video._sliderContainer.isConnected && video._nativeMuteBtn === nativeBtn) {
    return;
  }

  activeVideos.add(video);
  video._nativeMuteBtn = nativeBtn;
  video._lastBtnRect = null; // СБРОС КЭША: принудительно пересчитываем координаты для нового слайда

  // Слайдер крепится к общему контейнеру, чтобы быть выше защитных слоев
  const container = findCommonAncestor(video, nativeBtn);

  const containerStyle = window.getComputedStyle(container);
  if (containerStyle.position === 'static') {
    container.style.position = 'relative';
  }
  container.style.overflow = 'visible'; // Предотвращаем обрезку слайдера

  const sliderContainer = document.createElement('div');
  sliderContainer.className = 'ig-volume-slider-container';

  // Принудительно выводим слайдер на самый верхний слой (поверх градиента)
  sliderContainer.style.position = 'absolute';
  sliderContainer.style.zIndex = '2147483647';
  sliderContainer.style.pointerEvents = 'auto';

  sliderContainer.innerHTML = `
    <input type="range" class="ig-volume-slider" min="0" max="1" step="0.01" value="${globalSliderValue}">
  `;

  video._sliderContainer = sliderContainer;
  container.appendChild(sliderContainer);

  const slider = sliderContainer.querySelector('.ig-volume-slider');
  updateSliderGradient(slider, globalSliderValue);

  updateSliderPosition(video, nativeBtn, sliderContainer);

  const sliderCaptureEvents = ['click', 'dragstart', 'selectstart'];
  sliderCaptureEvents.forEach(eventName => {
    sliderContainer.addEventListener(eventName, (e) => {
      e.stopPropagation();
      e.preventDefault();
    }, { capture: true });
  });

  slider.addEventListener('dragstart', (e) => {
    e.stopPropagation();
    e.preventDefault();
  }, { capture: true });

  const sliderBubbleEvents = ['mousedown', 'mouseup', 'pointerdown', 'pointerup'];
  sliderBubbleEvents.forEach(eventName => {
    sliderContainer.addEventListener(eventName, (e) => {
      e.stopPropagation();
    });
  });

  slider.addEventListener('click', (e) => {
    lastUserInteractionTime = Date.now();
    e.stopPropagation();
    e.preventDefault();
  });
  slider.addEventListener('mousedown', (e) => {
    lastUserInteractionTime = Date.now();
    e.stopPropagation();
  });
  slider.addEventListener('pointerdown', (e) => {
    lastUserInteractionTime = Date.now();
    e.stopPropagation();
  });

  let hideTimer = null;

  function showSlider() {
    clearTimeout(hideTimer);
    updateSliderPosition(video, nativeBtn, sliderContainer);
    sliderContainer.classList.add('ig-expanded');
  }

  function hideSlider() {
    hideTimer = setTimeout(() => {
      if (!nativeBtn.matches(':hover') && !sliderContainer.matches(':hover')) {
        sliderContainer.classList.remove('ig-expanded');
      }
    }, 600);
  }
  // Удаляем старые обработчики с кнопки во избежание их накопления при повторной инъекции
  if (nativeBtn._oldShowSlider) nativeBtn.removeEventListener('mouseenter', nativeBtn._oldShowSlider);
  if (nativeBtn._oldHideSlider) nativeBtn.removeEventListener('mouseleave', nativeBtn._oldHideSlider);
  if (nativeBtn._oldClickHandler) nativeBtn.removeEventListener('click', nativeBtn._oldClickHandler, { capture: true });

  nativeBtn._oldShowSlider = showSlider;
  nativeBtn._oldHideSlider = hideSlider;

  nativeBtn.addEventListener('mouseenter', showSlider);
  nativeBtn.addEventListener('mouseleave', hideSlider);

  sliderContainer.addEventListener('mouseenter', showSlider);
  sliderContainer.addEventListener('mouseleave', hideSlider);

  const clickHandler = () => {
    if (nativeBtn._ignoreClick) return;
    lastUserInteractionTime = Date.now();

    video._ignoreMuteBtnSync = true;
    setTimeout(() => {
      video._ignoreMuteBtnSync = false;
    }, 10);

    const iconShowsMuted = isNativeButtonMuted(nativeBtn, video);
    globalMuted = !iconShowsMuted;

    saveSettings();
    syncAllVideos();
  };

  nativeBtn._oldClickHandler = clickHandler;
  nativeBtn.addEventListener('click', clickHandler, { capture: true, passive: true });

  slider.addEventListener('input', (e) => {
    lastUserInteractionTime = Date.now();
    globalSliderValue = parseFloat(e.target.value);

    updateSliderGradient(e.target, globalSliderValue);

    if (globalSliderValue > 0) {
      globalMuted = false;
    } else {
      globalMuted = true;
    }
    saveSettings();
    syncAllVideos();
    syncNativeButtonMuteState(video);
  });

  // Предотвращаем застревание фокуса на ползунке во избежание блокировки клавиши ArrowDown
  const blurSlider = () => {
    if (document.activeElement === slider) {
      slider.blur();
    }
  };
  slider.addEventListener('mouseup', blurSlider);
  slider.addEventListener('pointerup', blurSlider);
  slider.addEventListener('touchend', blurSlider);

  const handleWheel = (e) => {
    if (video.paused) return;
    e.preventDefault();
    e.stopPropagation();

    lastUserInteractionTime = Date.now();

    const delta = e.deltaY < 0 ? 0.05 : -0.05;
    globalSliderValue = Math.max(0, Math.min(1, globalSliderValue + delta));
    if (globalSliderValue > 0) {
      globalMuted = false;
    } else {
      globalMuted = true;
    }

    saveSettings();
    syncAllVideos();
    syncNativeButtonMuteState(video);
  };

  // Удаляем старый обработчик wheel перед регистрацией нового, чтобы не дублировать их на одном элементе видео
  if (video._oldHandleWheel) {
    video.removeEventListener('wheel', video._oldHandleWheel, { capture: true });
  }
  video._oldHandleWheel = handleWheel;
  video.addEventListener('wheel', handleWheel, { passive: false, capture: true });

  sliderContainer.addEventListener('wheel', handleWheel, { passive: false });

  // Изолированный перехват первого клика строго на уровне локального контейнера плеера
  const clickTarget = video.parentElement || video;
  if (!clickTarget._hasFirstClickUnmuteListener) {
    clickTarget._hasFirstClickUnmuteListener = true;
    clickTarget.addEventListener('click', (e) => {
      const nativeBtn = video._nativeMuteBtn || findNativeMuteButton(video);
      const actionBar = video._cachedActionBar || findReelsActionBar(video);

      // Проверяем, совершен ли клик по элементам управления звуком или панели скорости
      const isControlClick =
        (nativeBtn && (nativeBtn === e.target || nativeBtn.contains(e.target))) ||
        (actionBar && actionBar.contains(e.target)) ||
        e.target.closest('.ig-volume-slider-container, .ig-video-scrubber-container, .ig-action-item, input[type="range"]');

      if (isControlClick) return;

      if (!firstUnmuteTriggered) {
        const iconShowsMuted = nativeBtn ? isNativeButtonMuted(nativeBtn, video) : false;

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

  if (!video._hasVolumeChangeListener) {
    video._hasVolumeChangeListener = true;

    // ГАРАНТИЯ СКОРОСТИ: Принудительный сброс/установка скорости на ключевых этапах инициализации медиа-потока.
    const enforceSpeed = () => {
      const isVideoReel = checkIsReel(video);
      const targetSpeed = isVideoReel ? globalPlaybackSpeed : 1.0;

      const originalSetter = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'playbackRate').set;
      if (originalSetter) {
        originalSetter.call(video, targetSpeed);
      } else {
        video.playbackRate = targetSpeed;
      }

      // АППАРАТНЫЙ ХАК: Выполняем микро-seek только когда видео АКТИВНО воспроизводится (!video.paused),
      // так как только при запущенном аудио-конвейере декодер Chromium сбрасывает буфер скорости.
      if (!video._hasDoneSpeedPipelineFlush && !video.paused && video.readyState >= 2) {
        video._hasDoneSpeedPipelineFlush = true;
        const curTime = video.currentTime;
        video.currentTime = curTime > 0 ? curTime : 0.001;
      }
    };

    // Навешиваем жесткую сверку скорости на всю цепочку загрузки и старта медиа
    video.addEventListener('play', enforceSpeed, { passive: true });
    video.addEventListener('playing', enforceSpeed, { passive: true });
    video.addEventListener('loadedmetadata', enforceSpeed, { passive: true });
    video.addEventListener('loadeddata', enforceSpeed, { passive: true });
    video.addEventListener('canplay', enforceSpeed, { passive: true });

    video.addEventListener('volumechange', () => {
      if (video._ignoreVolumechange) return;

      if (hasUserInteracted()) {
        if (video._volumechangeEventTimer) {
          clearTimeout(video._volumechangeEventTimer);
        }

        video._volumechangeEventTimer = setTimeout(() => {
          video._ignoreVolumechange = true;
          video.volume = globalMuted ? 0 : Math.pow(globalSliderValue, 2);

          const container = video._sliderContainer;
          if (container) {
            const sld = container.querySelector('.ig-volume-slider');
            if (sld) {
              sld.value = globalSliderValue;
              updateSliderGradient(sld, globalSliderValue);
            }
          }

          if (video._ignoreVolumechangeResetTimer) {
            clearTimeout(video._ignoreVolumechangeResetTimer);
          }
          video._ignoreVolumechangeResetTimer = setTimeout(() => {
            video._ignoreVolumechange = false;
            video._ignoreVolumechangeResetTimer = null;
          }, 10); // Сокращено до 10мс для моментального отклика слайдера

          video._volumechangeEventTimer = null;
        }, 10); // Сокращено до 10мс
      }
    });

    video.addEventListener('play', () => {
      // Управление громкостью (активируется после первого взаимодействия пользователя)
      if (hasUserInteracted()) {
        video._ignoreVolumechange = true;
        const targetVol = globalMuted ? 0 : Math.pow(globalSliderValue, 2);
        video.volume = targetVol;

        const sc = video._sliderContainer;
        if (sc) {
          const sld = sc.querySelector('.ig-volume-slider');
          if (sld) {
            sld.value = globalSliderValue;
            updateSliderGradient(sld, globalSliderValue);
          }
        }
        setTimeout(() => {
          video._ignoreVolumechange = false;
        }, 10);
      }
    });
  }

  syncAllVideos();
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
        // Форсируем ускорение только если видео является частью Reels, иначе разрешаем стандартную скорость
        const isReel = checkIsReel(this);
        if (isReel) {
          originalSetter.call(this, globalPlaybackSpeed);
        } else {
          originalSetter.call(this, val);
        }
      }
    });

    // Инициализируем стартовую скорость
    const isReel = checkIsReel(video);
    originalSetter.call(video, isReel ? globalPlaybackSpeed : 1.0);
  }
}

// --- ИНЪЕКЦИЯ РЕГУЛЯТОРА СКОРОСТИ И АВТОСКИПА ---
function injectExtraControls(video, cachedActionBar) {
  const isReel = checkIsReel(video);

  if (!isReel) {
    // Если это не Reels — сбрасываем скорость на 1x и выходим
    if (video.playbackRate !== 1.0) {
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
      <div class="ig-speed-menu">
        <div class="ig-speed-menu-item ${Math.abs(globalPlaybackSpeed - 0.25) < 0.01 ? 'active' : ''}" data-speed="0.25">0.25x</div>
        <div class="ig-speed-menu-item ${Math.abs(globalPlaybackSpeed - 0.5) < 0.01 ? 'active' : ''}" data-speed="0.5">0.5x</div>
        <div class="ig-speed-menu-item ${Math.abs(globalPlaybackSpeed - 1.0) < 0.01 ? 'active' : ''}" data-speed="1">1x</div>
        <div class="ig-speed-menu-item ${Math.abs(globalPlaybackSpeed - 1.25) < 0.01 ? 'active' : ''}" data-speed="1.25">1.25x</div>
        <div class="ig-speed-menu-item ${Math.abs(globalPlaybackSpeed - 1.5) < 0.01 ? 'active' : ''}" data-speed="1.5">1.5x</div>
        <div class="ig-speed-menu-item ${Math.abs(globalPlaybackSpeed - 2.0) < 0.01 ? 'active' : ''}" data-speed="2">2x</div>
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
  const speedMenu = speedItem.querySelector('.ig-speed-menu');

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

  const menuItems = speedItem.querySelectorAll('.ig-speed-menu-item');
  menuItems.forEach(item => {
    const selectSpeed = (e) => {
      e.stopPropagation();
      e.preventDefault();
      const speed = parseFloat(item.getAttribute('data-speed'));
      globalPlaybackSpeed = speed;
      saveSettings();
      syncAllVideos();
      // Меню больше не закрывается по таймеру при клике, позволяя удобно перекликивать скорости
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
    e.preventDefault();
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

        const isCustomElement = sibling.classList.contains('ig-volume-slider-container') ||
          sibling.classList.contains('ig-video-scrubber-container') ||
          sibling.querySelector('.ig-volume-slider-container, .ig-video-scrubber-container');

        // Если элемент абсолютный, не кастомный И стиль pointer-events еще НЕ равен 'none'
        if (isAbsoluteOrFixed && !isCustomElement && style.pointerEvents !== 'none') {
          sibling.style.setProperty('pointer-events', 'none', 'important');
        }
      }
    }

    current = parent;
  }
}

// --- СКРЫТИЕ НАТИВНОГО ВЕРТИКАЛЬНОГО СЛАЙДЕРА ---
function hideNativeVerticalSlider(video, currentBtn) {
  if (!currentBtn || !currentBtn.isConnected) return;

  let parent = currentBtn.parentElement;
  for (let depth = 0; depth < 2 && parent; depth++) {
    const siblings = parent.children;
    for (let i = 0; i < siblings.length; i++) {
      const sibling = siblings[i];
      if (
        sibling !== currentBtn &&
        !sibling.classList.contains('ig-volume-slider-container') &&
        !sibling.classList.contains('ig-video-scrubber-container') &&
        !sibling.contains(currentBtn)
      ) {
        const style = window.getComputedStyle(sibling);
        const isAbsolute = style.position === 'absolute' || style.position === 'fixed';
        const height = parseFloat(style.height) || 0;
        const width = parseFloat(style.width) || 0;
        const isVertical = height > width && height > 40;

        if (isAbsolute && isVertical) {
          sibling.style.setProperty('display', 'none', 'important');
        }
      }
    }
    parent = parent.parentElement;
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

      video._hasScrubber = false;
      video._hasExtraControls = false;

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

    // Получаем текущий контейнер плеера для валидации кэшированных элементов
    const playerContainer = video.closest('section, [role="dialog"], article, .x17505xr, .x10b77sg') || video.parentElement;

    // Оптимизация: берем кнопку из кэша, если она все еще валидна, подключена к DOM и находится в текущем контейнере
    let currentBtn = video._nativeMuteBtn;
    if (!currentBtn || !currentBtn.isConnected || !playerContainer || !playerContainer.contains(currentBtn)) {
      currentBtn = findNativeMuteButton(video);
      if (currentBtn) {
        video._nativeMuteBtn = currentBtn;
      }
    }

    if (currentBtn) {
      // Скрываем нативный вертикальный слайдер звука
      hideNativeVerticalSlider(video, currentBtn);

      // Определяем ожидаемый родительский контейнер для слайдера и скруббера
      const expectedParent = findCommonAncestor(video, currentBtn) || video.parentElement;

      // Внедряем слайдер громкости (пересоздаем его, если он удален, кнопка изменилась или родительский контейнер устарел)
      if (!video._sliderContainer || !video._sliderContainer.isConnected || video._nativeMuteBtn !== currentBtn || video._sliderContainer.parentElement !== expectedParent) {
        if (video._sliderContainer) {
          video._sliderContainer.remove();
          video._sliderContainer = null;
        }

        injectSliderNextTo(video, currentBtn);
      } else {
        // Оптимизация производительности: пересчитываем позицию слайдера только когда он развернут/виден
        if (video._sliderContainer.classList.contains('ig-expanded')) {
          updateSliderPosition(video, currentBtn, video._sliderContainer);
        }

        // ГАРАНТИЯ СЛОЕВ: Сдвигаем слайдер в самый конец контейнера, чтобы новые слои React не перекрывали его hover
        const parent = video._sliderContainer.parentElement;
        if (parent && parent.lastElementChild !== video._sliderContainer) {
          parent.appendChild(video._sliderContainer);
        }
      }

      // Внедряем скруббер (перемотку) в тот же верхний контейнер, когда кнопка звука найдена
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

    // Если это не Reels — полностью удаляем интерцептор скорости и сбрасываем её на 1.0
    const isReel = checkIsReel(video);
    if (!isReel) {
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
const globalScanInterval = setInterval(triggerScan, 300);

// --- ГЛОБАЛЬНЫЙ СЛУШАТЕЛЬ КЛАВИШ ---
document.addEventListener('keydown', (e) => {
  const key = e.key.toLowerCase();
  if (['m', 'arrowup', 'arrowdown'].includes(key)) {
    lastUserInteractionTime = Date.now();
  }
}, { capture: true, passive: true });