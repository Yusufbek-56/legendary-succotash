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

    // Intercept requests to mock all Instagram formats and serve our mock.html
    await page.setRequestInterception(true);
    page.on('request', (request) => {
      const url = request.url();
      if (
        url.includes('instagram.com/reels/test/') ||
        url.includes('instagram.com/stories/test/') ||
        url.includes('instagram.com/p/test/')
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
    await page.addScriptTag({ path: path.join(__dirname, 'content.js') });

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
    await page.addScriptTag({ path: path.join(__dirname, 'content.js') });

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

    // Click story speed button to toggle speed to 2.0x
    console.log('[TEST 2] Clicking Story speed button...');
    await page.click('#story-container .ig-inline-speed-btn');
    await sleep(800);

    storyPlaybackSpeed = await page.evaluate(() => {
      const video = document.querySelector('video');
      const btn = document.querySelector('#story-container .ig-inline-speed-btn');
      return {
        rate: video.playbackRate,
        text: btn.textContent,
        isActive: btn.classList.contains('ig-speed-active')
      };
    });
    console.log('[TEST 2] Post-click Story speed status:', storyPlaybackSpeed);
    if (storyPlaybackSpeed.rate !== 2.0) {
      throw new Error('Stories: Failed to change playback speed to 2.0!');
    }
    if (!storyPlaybackSpeed.isActive || storyPlaybackSpeed.text !== '2x') {
      throw new Error('Stories: Speed button styling/text was not updated correctly!');
    }

    // Click it again to toggle back to 1.0x
    console.log('[TEST 2] Clicking Story speed button again to revert...');
    await page.click('#story-container .ig-inline-speed-btn');
    await sleep(800);

    storyPlaybackSpeed = await page.evaluate(() => {
      const video = document.querySelector('video');
      const btn = document.querySelector('#story-container .ig-inline-speed-btn');
      return {
        rate: video.playbackRate,
        text: btn.textContent,
        isActive: btn.classList.contains('ig-speed-active')
      };
    });
    console.log('[TEST 2] Reverted Story speed status:', storyPlaybackSpeed);
    if (storyPlaybackSpeed.rate !== 1.0) {
      throw new Error('Stories: Failed to revert playback speed to 1.0!');
    }
    if (storyPlaybackSpeed.isActive || storyPlaybackSpeed.text !== '1x') {
      throw new Error('Stories: Speed button active styling was not cleared!');
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
    await page.addScriptTag({ path: path.join(__dirname, 'content.js') });

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

    // Toggle speed on Feed post
    console.log('[TEST 3] Debugging Feed post speed button...');
    const debugInfo = await page.evaluate(() => {
      const btn = document.querySelector('#feed-container .ig-feed-speed-btn');
      if (!btn) return 'Button not found';
      const rect = btn.getBoundingClientRect();
      const x = rect.left + rect.width / 2;
      const y = rect.top + rect.height / 2;
      const elFromPoint = document.elementFromPoint(x, y);
      const style = window.getComputedStyle(btn);
      
      return {
        tagName: btn.tagName,
        className: btn.className,
        rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
        pointerEvents: style.pointerEvents,
        opacity: style.opacity,
        visibility: style.visibility,
        display: style.display,
        elementFromPoint: elFromPoint ? { tagName: elFromPoint.tagName, className: elFromPoint.className, id: elFromPoint.id } : null
      };
    });
    console.log('[TEST 3] Debug info:', debugInfo);

    console.log('[TEST 3] Clicking Feed post speed button...');
    await page.click('#feed-container .ig-feed-speed-btn');
    await sleep(800);

    const feedPlaybackSpeed = await page.evaluate(() => {
      const video = document.querySelector('video');
      const btn = document.querySelector('#feed-container .ig-feed-speed-btn');
      return {
        rate: video.playbackRate,
        text: btn.textContent,
        isActive: btn.classList.contains('ig-speed-active')
      };
    });
    console.log('[TEST 3] Post-click Feed speed status:', feedPlaybackSpeed);
    if (feedPlaybackSpeed.rate !== 2.0) {
      throw new Error('Feed Post: Failed to change playback speed to 2.0!');
    }
    if (!feedPlaybackSpeed.isActive || feedPlaybackSpeed.text !== '2x') {
      throw new Error('Feed Post: Speed button styling/text was not updated correctly!');
    }

    await page.screenshot({ path: path.join(__dirname, 'feed_success.png') });
    console.log('[TEST 3] Screenshot saved to feed_success.png');

    console.log('\n--- ALL TESTS COMPLETED SUCCESSFULLY ---');
  } catch (error) {
    console.error('\n--- TEST FAILED ---');
    console.error(error);
  } finally {
    await browser.close();
  }
})();
