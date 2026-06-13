const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

(async () => {
  const extensionPath = path.resolve(__dirname);
  console.log('--- STARTING AUTOMATED INSTAGRAM VOLUME CONTROLLER TEST ---');
  console.log('Extension path:', extensionPath);

  // Auto-detect standard system Chrome installations on Windows
  const possibleChromePaths = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    path.join(process.env.LOCALAPPDATA || 'C:\\Users\\user\\AppData\\Local', 'Google\\Chrome\\Application\\chrome.exe')
  ];

  let executablePath = undefined;
  for (const chromePath of possibleChromePaths) {
    if (fs.existsSync(chromePath)) {
      executablePath = chromePath;
      console.log('Found system Google Chrome at:', executablePath);
      break;
    }
  }

  if (!executablePath) {
    console.log('Could not find system Chrome. Puppeteer will try standard launch...');
  }

  // Launch browser with extension loaded
  const browser = await puppeteer.launch({
    headless: false, // Extensions only load in headful mode
    executablePath, // Use system Chrome if found
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--mute-audio' // Mute host sound during testing
    ]
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1200, height: 900 });

    // Capture console messages from the browser page
    page.on('console', msg => {
      console.log(`[BROWSER CONSOLE] ${msg.type().toUpperCase()}: ${msg.text()}`);
    });

    page.on('pageerror', err => {
      console.error(`[BROWSER ERROR]: ${err.message}`);
    });

    // Intercept requests to mock all Instagram formats and serve our mock.html, as well as serving local source files
    await page.setRequestInterception(true);
    page.on('request', (request) => {
      const url = request.url();
      if (url.includes('/src/')) {
        const relativePath = url.split('/src/')[1];
        const filePath = path.join(__dirname, 'src', relativePath);
        if (fs.existsSync(filePath)) {
          request.respond({
            status: 200,
            contentType: 'application/javascript',
            body: fs.readFileSync(filePath, 'utf8')
          });
        } else {
          request.respond({ status: 404 });
        }
      } else if (
        url.includes('instagram.com/reels/test/') ||
        url.includes('instagram.com/stories/test/') ||
        url.includes('instagram.com/p/test')
      ) {
        const mockHtmlPath = path.join(__dirname, 'mock.html');
        const mockHtml = fs.readFileSync(mockHtmlPath, 'utf8');
        request.respond({
          status: 200,
          contentType: 'text/html',
          body: mockHtml
        });
      } else {
        request.continue();
      }
    });

    // ==========================================
    // --- TEST 1: REELS MODE ---
    // ==========================================
    console.log('\n==========================================');
    console.log('[TEST 1] Testing Reels Mode...');
    console.log('==========================================');
    
    await page.goto('https://www.instagram.com/reels/test/', { waitUntil: 'load' });
    await page.addStyleTag({ path: path.join(__dirname, 'content.css') });
    await page.addScriptTag({ path: path.join(__dirname, 'content.js'), type: 'module' });

    console.log('[TEST 1] Waiting for script injection...');
    await sleep(2000);

    const reelsResults = await page.evaluate(() => {
      const reel = document.querySelector('#reel-container');
      const scrubber = reel.querySelector('.ig-video-scrubber-container');
      const speedItem = reel.querySelector('.ig-speed-item');
      const autoskipItem = reel.querySelector('.ig-autoskip-item');
      return {
        hasScrubber: !!scrubber,
        hasSpeedSidebarItem: !!speedItem,
        hasAutoskipSidebarItem: !!autoskipItem
      };
    });

    console.log('[TEST 1] Reels elements status:', reelsResults);
    if (!reelsResults.hasScrubber) {
      throw new Error('Reels: Missing injected scrubber container!');
    }
    if (!reelsResults.hasSpeedSidebarItem || !reelsResults.hasAutoskipSidebarItem) {
      throw new Error('Reels: Missing extra controls in action bar!');
    }

    // Test first-click unmute on Reels
    const reelsInitialMuted = await page.evaluate(() => {
      return document.querySelector('video').muted;
    });
    console.log('[TEST 1] Reels video initially muted:', reelsInitialMuted);

    // Play video programmatically to emulate auto-play
    await page.evaluate(() => {
      document.querySelector('video').play();
    });
    await sleep(500);

    // Click the video viewport to trigger first-click unmute
    console.log('[TEST 1] Clicking video element to unmute...');
    await page.click('video');
    await sleep(1000);

    const reelsPostClickMuted = await page.evaluate(() => {
      return document.querySelector('video').muted;
    });
    console.log('[TEST 1] Reels video muted after viewport click:', reelsPostClickMuted);
    if (reelsPostClickMuted) {
      throw new Error('Reels: First-click viewport unmute failed!');
    }

    await page.screenshot({ path: path.join(__dirname, 'reels_success.png') });
    console.log('[TEST 1] Screenshot saved to reels_success.png');

    // ==========================================
    // --- TEST 2: STORIES MODE ---
    // ==========================================
    console.log('\n==========================================');
    console.log('[TEST 2] Testing Stories Mode...');
    console.log('==========================================');

    await page.goto('https://www.instagram.com/stories/test/', { waitUntil: 'load' });
    await page.addStyleTag({ path: path.join(__dirname, 'content.css') });
    await page.addScriptTag({ path: path.join(__dirname, 'content.js'), type: 'module' });

    console.log('[TEST 2] Waiting for script injection...');
    await sleep(2000);

    const storySpeedBtnExists = await page.evaluate(() => {
      const btn = document.querySelector('#story-container .ig-inline-speed-btn');
      return !!btn;
    });

    console.log('[TEST 2] Story speed button injected:', storySpeedBtnExists);
    if (!storySpeedBtnExists) {
      throw new Error('Stories: Speed button not injected in story header!');
    }

    // Initially playback speed should be 1.0 (since button exists but speed is default 1x)
    let storyPlaybackSpeed = await page.evaluate(() => {
      return document.querySelector('video').playbackRate;
    });
    console.log('[TEST 2] Initial Story playback speed:', storyPlaybackSpeed);

    // Click story speed button to open the menu
    console.log('[TEST 2] Clicking Story speed button to open menu...');
    await page.click('#story-container .ig-inline-speed-btn');
    await sleep(300);

    let menuExists = await page.evaluate(() => !!document.querySelector('.ig-speed-menu'));
    console.log('[TEST 2] Speed menu exists:', menuExists);
    if (!menuExists) throw new Error('Stories: Speed menu did not open on button click');

    // Select 0.5x speed
    console.log('[TEST 2] Selecting 0.5x speed from menu...');
    await page.evaluate(() => {
      const items = Array.from(document.querySelectorAll('.ig-speed-menu-item'));
      const target = items.find(el => el.textContent.trim() === '0.5x');
      if (target) target.click();
    });
    await sleep(300);

    storyPlaybackSpeed = await page.evaluate(() => {
      const video = document.querySelector('video');
      const btn = document.querySelector('#story-container .ig-inline-speed-btn');
      const menu = document.querySelector('.ig-speed-menu');
      return {
        rate: video.playbackRate,
        text: btn.textContent,
        isActive: btn.classList.contains('ig-speed-active'),
        menuExists: !!menu
      };
    });
    console.log('[TEST 2] After selecting 0.5x:', storyPlaybackSpeed);
    if (storyPlaybackSpeed.rate !== 0.5) throw new Error('Stories: Expected playback rate 0.5, got ' + storyPlaybackSpeed.rate);
    if (storyPlaybackSpeed.text !== '0.5x') throw new Error('Stories: Expected button text "0.5x", got ' + storyPlaybackSpeed.text);
    if (!storyPlaybackSpeed.isActive) throw new Error('Stories: Button should have active style for 0.5x');
    if (storyPlaybackSpeed.menuExists) throw new Error('Stories: Menu should have closed after selection');

    // Click again, select 1x (Normal) to revert
    console.log('[TEST 2] Re-opening speed menu...');
    await page.click('#story-container .ig-inline-speed-btn');
    await sleep(300);

    console.log('[TEST 2] Selecting 1x (Normal) from menu...');
    await page.evaluate(() => {
      const items = Array.from(document.querySelectorAll('.ig-speed-menu-item'));
      const target = items.find(el => el.textContent.trim() === '1x (Normal)');
      if (target) target.click();
    });
    await sleep(300);

    storyPlaybackSpeed = await page.evaluate(() => {
      const video = document.querySelector('video');
      const btn = document.querySelector('#story-container .ig-inline-speed-btn');
      return { rate: video.playbackRate, text: btn.textContent, isActive: btn.classList.contains('ig-speed-active') };
    });
    console.log('[TEST 2] After selecting 1x:', storyPlaybackSpeed);
    if (storyPlaybackSpeed.rate !== 1.0) throw new Error('Stories: Expected playback rate 1.0, got ' + storyPlaybackSpeed.rate);
    if (storyPlaybackSpeed.text !== '1x') throw new Error('Stories: Expected button text "1x", got ' + storyPlaybackSpeed.text);
    if (storyPlaybackSpeed.isActive) throw new Error('Stories: Button should NOT have active style for 1x');

    // Test click outside to close
    console.log('[TEST 2] Opening speed menu to test click-outside close...');
    await page.click('#story-container .ig-inline-speed-btn');
    await sleep(300);

    menuExists = await page.evaluate(() => !!document.querySelector('.ig-speed-menu'));
    if (!menuExists) throw new Error('Stories: Speed menu failed to open for click-outside test');

    console.log('[TEST 2] Clicking outside on body...');
    await page.click('body', { delay: 10 });
    await sleep(300);

    menuExists = await page.evaluate(() => !!document.querySelector('.ig-speed-menu'));
    console.log('[TEST 2] Menu exists after click outside:', menuExists);
    if (menuExists) throw new Error('Stories: Menu did not close on clicking outside');

    // Verify that the close button overlay is not blocked (pointer-events is not 'none')
    const closeBtnPointerEvents = await page.evaluate(() => {
      const overlay = document.querySelector('.story-close-overlay');
      return window.getComputedStyle(overlay).pointerEvents;
    });
    console.log('[TEST 2] Story close overlay pointer-events:', closeBtnPointerEvents);
    if (closeBtnPointerEvents === 'none') {
      throw new Error('Stories: Close button overlay has pointer-events: none (is blocked)!');
    }

    await page.screenshot({ path: path.join(__dirname, 'stories_success.png') });
    console.log('[TEST 2] Screenshot saved to stories_success.png');

    // ==========================================
    // --- TEST 3: FEED POST MODE ---
    // ==========================================
    console.log('\n==========================================');
    console.log('[TEST 3] Testing Feed Post Mode...');
    console.log('==========================================');

    await page.goto('https://www.instagram.com/p/test/', { waitUntil: 'load' });
    await page.addStyleTag({ path: path.join(__dirname, 'content.css') });
    await page.addScriptTag({ path: path.join(__dirname, 'content.js'), type: 'module' });

    console.log('[TEST 3] Waiting for script injection...');
    await sleep(2000);

    const feedSpeedBtnExists = await page.evaluate(() => {
      const btn = document.querySelector('#feed-container .ig-feed-speed-btn');
      return !!btn;
    });

    console.log('[TEST 3] Feed speed button injected next to mute button:', feedSpeedBtnExists);
    if (!feedSpeedBtnExists) {
      throw new Error('Feed Post: Speed button not injected!');
    }

    // Click to open menu
    console.log('[TEST 3] Clicking Feed speed button to open menu...');
    await page.click('#feed-container .ig-feed-speed-btn');
    await sleep(300);

    menuExists = await page.evaluate(() => !!document.querySelector('.ig-speed-menu'));
    console.log('[TEST 3] Feed Speed menu exists:', menuExists);
    if (!menuExists) throw new Error('Feed Post: Speed menu did not open');

    // Select 2.5x speed
    console.log('[TEST 3] Selecting 2.5x speed from menu...');
    await page.evaluate(() => {
      const items = Array.from(document.querySelectorAll('.ig-speed-menu-item'));
      const target = items.find(el => el.textContent.trim() === '2.5x');
      if (target) target.click();
    });
    await sleep(300);

    feedSpeed = await page.evaluate(() => {
      const video = document.querySelector('video');
      const btn = document.querySelector('#feed-container .ig-feed-speed-btn');
      return { rate: video.playbackRate, text: btn.textContent, isActive: btn.classList.contains('ig-speed-active') };
    });
    console.log('[TEST 3] After selecting 2.5x:', feedSpeed);
    if (feedSpeed.rate !== 2.5) throw new Error('Feed Post: Expected playback rate 2.5, got ' + feedSpeed.rate);
    if (feedSpeed.text !== '2.5x') throw new Error('Feed Post: Expected text "2.5x", got ' + feedSpeed.text);
    if (!feedSpeed.isActive) throw new Error('Feed Post: Button should have active style for 2.5x');

    // Select 1.0x to revert
    console.log('[TEST 3] Re-opening Feed speed menu...');
    await page.click('#feed-container .ig-feed-speed-btn');
    await sleep(300);

    console.log('[TEST 3] Selecting 1x (Normal) from menu...');
    await page.evaluate(() => {
      const items = Array.from(document.querySelectorAll('.ig-speed-menu-item'));
      const target = items.find(el => el.textContent.trim() === '1x (Normal)');
      if (target) target.click();
    });
    await sleep(300);

    feedSpeed = await page.evaluate(() => {
      const video = document.querySelector('video');
      const btn = document.querySelector('#feed-container .ig-feed-speed-btn');
      return { rate: video.playbackRate, text: btn.textContent, isActive: btn.classList.contains('ig-speed-active') };
    });
    console.log('[TEST 3] After reverting to 1x:', feedSpeed);
    if (feedSpeed.rate !== 1.0) throw new Error('Feed Post: Expected rate 1.0, got ' + feedSpeed.rate);
    if (feedSpeed.isActive) throw new Error('Feed Post: Button should NOT have active style for 1x');

    await page.screenshot({ path: path.join(__dirname, 'feed_success.png') });
    console.log('[TEST 3] Screenshot saved to feed_success.png');

    // ==========================================
    // --- TEST 4: FEED POST MODE (NO NATIVE MUTE BUTTON) ---
    // ==========================================
    console.log('\n==========================================');
    console.log('[TEST 4] Testing Feed Post Mode (No Native Mute)...');
    console.log('==========================================');

    await page.goto('https://www.instagram.com/p/test-no-mute/', { waitUntil: 'load' });
    await page.addStyleTag({ path: path.join(__dirname, 'content.css') });
    await page.addScriptTag({ path: path.join(__dirname, 'content.js'), type: 'module' });

    console.log('[TEST 4] Waiting for script injection...');
    await sleep(2000);

    const feedNoMuteSpeedBtnExists = await page.evaluate(() => {
      const btn = document.querySelector('#feed-container .ig-feed-speed-btn');
      return !!btn;
    });

    console.log('[TEST 4] Feed speed button injected (no native mute context):', feedNoMuteSpeedBtnExists);
    if (!feedNoMuteSpeedBtnExists) {
      throw new Error('Feed Post (No Mute): Speed button not injected!');
    }

    // Verify positioning fallback (should be at bottom 12px, right 12px)
    const feedNoMuteSpeedBtnPos = await page.evaluate(() => {
      const btn = document.querySelector('#feed-container .ig-feed-speed-btn');
      return {
        bottom: btn.style.bottom,
        right: btn.style.right
      };
    });
    console.log('[TEST 4] Feed speed button fallback positioning:', feedNoMuteSpeedBtnPos);
    if (feedNoMuteSpeedBtnPos.bottom !== '12px' || feedNoMuteSpeedBtnPos.right !== '12px') {
      throw new Error('Feed Post (No Mute): Speed button does not have correct fallback styles (bottom: 12px, right: 12px)!');
    }

    // Click to open menu
    console.log('[TEST 4] Clicking Feed speed button to open menu...');
    await page.click('#feed-container .ig-feed-speed-btn');
    await sleep(300);

    menuExists = await page.evaluate(() => !!document.querySelector('.ig-speed-menu'));
    console.log('[TEST 4] Feed Speed menu exists:', menuExists);
    if (!menuExists) throw new Error('Feed Post (No Mute): Speed menu did not open');

    // Select 1.5x speed
    console.log('[TEST 4] Selecting 1.5x speed from menu...');
    await page.evaluate(() => {
      const items = Array.from(document.querySelectorAll('.ig-speed-menu-item'));
      const target = items.find(el => el.textContent.trim() === '1.5x');
      if (target) target.click();
    });
    await sleep(300);

    const feedNoMuteSpeed = await page.evaluate(() => {
      const video = document.querySelector('video');
      const btn = document.querySelector('#feed-container .ig-feed-speed-btn');
      return { rate: video.playbackRate, text: btn.textContent, isActive: btn.classList.contains('ig-speed-active') };
    });
    console.log('[TEST 4] After selecting 1.5x (no native mute context):', feedNoMuteSpeed);
    if (feedNoMuteSpeed.rate !== 1.5) throw new Error('Feed Post (No Mute): Expected playback rate 1.5, got ' + feedNoMuteSpeed.rate);

    console.log('\n--- ALL TESTS COMPLETED SUCCESSFULLY ---');
  } catch (error) {
    console.error('\n--- TEST FAILED ---');
    console.error(error);
  } finally {
    await browser.close();
  }
})();
