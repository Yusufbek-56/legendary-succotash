// Core CSS injection for React reconciliation shield
export function injectCoreStyles() {
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
    main[role="main"] a, 
    main[role="main"] a *,
    main[role="main"] [role="link"],
    main[role="main"] [role="link"] * {
      pointer-events: auto !important;
      cursor: pointer !important;
    }

    article ._ac9s, .x17505xr ._ac9s, .x10b77sg ._ac9s, [role="dialog"] ._ac9s, ._as3a ._ac9s,
    article ._ab9m, .x17505xr ._ab9m, .x10b77sg ._ab9m, [role="dialog"] ._ab9m, ._as3a ._ab9m,
    article ._aajy, .x17505xr ._aajy, .x10b77sg ._aajy, [role="dialog"] ._aajy, ._as3a ._aajy,
    article ._aa_g, .x17505xr ._aa_g, .x10b77sg ._aa_g, [role="dialog"] ._aa_g, ._as3a ._aa_g,
    article ._aa8h, .x17505xr ._aa8h, .x10b77sg ._aa8h, [role="dialog"] ._aa8h, ._as3a ._aa8h,
    article ._aa8j, .x17505xr ._aa8j, .x10b77sg ._aa8j, [role="dialog"] ._aa8j, ._as3a ._aa8j {
      pointer-events: none !important;
    }
    ._ac7v {
      pointer-events: none !important;
    }
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
    .ig-video-scrubber-container {
      opacity: 1 !important;
      filter: none !important;
      mix-blend-mode: normal !important;
    }
  `;
  (document.head || document.documentElement).appendChild(style);
}