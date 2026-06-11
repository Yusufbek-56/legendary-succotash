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

    // Intercept requests to mock an Instagram Reels URL and serve our mock.html
    await page.setRequestInterception(true);
    page.on('request', (request) => {
      const url = request.url();
      if (url.includes('instagram.com/reels/test/')) {
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

    console.log('[TEST] Navigating to https://www.instagram.com/reels/test/ ...');
    await page.goto('https://www.instagram.com/reels/test/', { waitUntil: 'load' });

    console.log('[TEST] Injecting content script and styles manually...');
    await page.addStyleTag({ path: path.join(__dirname, 'content.css') });
    await page.addScriptTag({ path: path.join(__dirname, 'content.js') });

    console.log('[TEST] Waiting for extension to scan and inject controls...');
    await sleep(2500); // Allow time for scanAndInject to run multiple times

    // --- TEST 1: REEL 1 INJECTION & INITIAL STATE ---
    console.log('[TEST 1] Verifying Reel 1 initialization...');
    
    // Check if slider container exists in Reel 1
    const reel1HasSlider = await page.evaluate(() => {
      const reel1 = document.querySelector('#reel-1');
      const slider = reel1.querySelector('.ig-volume-slider-container');
      const scrubber = reel1.querySelector('.ig-video-scrubber-container');
      return {
        sliderExists: !!slider,
        scrubberExists: !!scrubber,
        sliderInCorrectContainer: slider && reel1.contains(slider),
        scrubberInCorrectContainer: scrubber && reel1.contains(scrubber)
      };
    });

    console.log('Reel 1 Injection Results:', reel1HasSlider);
    if (!reel1HasSlider.sliderExists || !reel1HasSlider.scrubberExists) {
      throw new Error('Reel 1: Missing injected slider or scrubber!');
    }
    if (!reel1HasSlider.sliderInCorrectContainer || !reel1HasSlider.scrubberInCorrectContainer) {
      throw new Error('Reel 1: Slider or scrubber injected in wrong container!');
    }

    // Hover over Reel 1 mute button to verify expansion
    console.log('[TEST 1] Hovering over Reel 1 mute button...');
    await page.hover('#reel-1 .native-mute-btn');
    await sleep(800); // Wait for transition css

    await page.screenshot({ path: path.join(__dirname, 'reel1_hover.png') });
    console.log('[TEST 1] Screenshot saved to reel1_hover.png');

    const reel1SliderExpanded = await page.evaluate(() => {
      const slider = document.querySelector('#reel-1 .ig-volume-slider-container');
      return slider.classList.contains('ig-expanded');
    });
    console.log('Reel 1 Slider expanded on hover:', reel1SliderExpanded);

    // Stop hover
    await page.mouse.move(0, 0);
    await sleep(1000); // Wait for slider to auto-hide

    // --- TEST 2: SCROLL TO REEL 2 & REEL 2 INJECTION ---
    console.log('[TEST 2] Scrolling to Reel 2...');
    await page.evaluate(() => {
      document.querySelector('#reel-2').scrollIntoView({ behavior: 'auto' });
    });
    await sleep(2000); // Wait for scroll and scanning

    // Verify Reel 2 elements are correctly injected within Reel 2 and not Reel 1
    const reel2HasSlider = await page.evaluate(() => {
      const reel1 = document.querySelector('#reel-1');
      const reel2 = document.querySelector('#reel-2');
      const slider = reel2.querySelector('.ig-volume-slider-container');
      const scrubber = reel2.querySelector('.ig-video-scrubber-container');
      return {
        sliderExists: !!slider,
        scrubberExists: !!scrubber,
        sliderInReel2: slider && reel2.contains(slider),
        scrubberInReel2: scrubber && reel2.contains(scrubber),
        doesNotContainReel1Slider: slider && !reel1.contains(slider)
      };
    });

    console.log('Reel 2 Injection Results:', reel2HasSlider);
    if (!reel2HasSlider.sliderExists || !reel2HasSlider.scrubberExists) {
      throw new Error('Reel 2: Missing injected slider or scrubber!');
    }
    if (!reel2HasSlider.sliderInReel2 || !reel2HasSlider.scrubberInReel2) {
      throw new Error('Reel 2: Slider or scrubber injected in wrong container!');
    }

    // Hover over Reel 2 mute button
    console.log('[TEST 2] Hovering over Reel 2 mute button...');
    await page.hover('#reel-2 .native-mute-btn');
    await sleep(800);

    await page.screenshot({ path: path.join(__dirname, 'reel2_hover.png') });
    console.log('[TEST 2] Screenshot saved to reel2_hover.png');

    const reel2SliderExpanded = await page.evaluate(() => {
      const slider = document.querySelector('#reel-2 .ig-volume-slider-container');
      return slider.classList.contains('ig-expanded');
    });
    console.log('Reel 2 Slider expanded on hover:', reel2SliderExpanded);
    if (!reel2SliderExpanded) {
      throw new Error('Reel 2 Slider failed to expand on hover! (The bug is not fixed)');
    }

    // Stop hover
    await page.mouse.move(0, 0);
    await sleep(1000);

    // --- TEST 3: FIRST-CLICK UNMUTE FEATURE PRESERVATION ---
    console.log('[TEST 3] Testing the "First-Click Unmute" feature on Reel 2...');
    
    // Check initial video state for Reel 2
    const initialReel2State = await page.evaluate(() => {
      const video = document.querySelector('#reel-2 video');
      return {
        paused: video.paused,
        muted: video.muted,
        volume: video.volume
      };
    });
    console.log('Initial Reel 2 Video state:', initialReel2State);

    // Verify first click unmute feature:
    // Click on the video element of Reel 2 (which should unmute it, trigger click on native button, and NOT pause it if it was playing, or play and unmute it)
    console.log('[TEST 3] Triggering first click on Reel 2 video viewport...');
    
    // Play video first if paused to verify that unmuting doesn't pause it
    await page.evaluate(() => {
      const video = document.querySelector('#reel-2 video');
      video.play();
    });
    await sleep(500);

    // Now click the video element
    await page.click('#reel-2 video');
    await sleep(1500); // Wait for events to bubble and native clicks to register

    await page.screenshot({ path: path.join(__dirname, 'first_click_unmute.png') });
    console.log('[TEST 3] Screenshot saved to first_click_unmute.png');

    const postClickReel2State = await page.evaluate(() => {
      const video = document.querySelector('#reel-2 video');
      const label = document.querySelector('#reel-2 .native-mute-btn').getAttribute('aria-label');
      return {
        paused: video.paused,
        muted: video.muted,
        volume: video.volume,
        nativeBtnLabel: label
      };
    });
    console.log('Post-Click Reel 2 Video state:', postClickReel2State);

    if (postClickReel2State.muted) {
      throw new Error('First-Click Unmute failed: Video is still muted!');
    }
    if (postClickReel2State.paused) {
      throw new Error('First-Click Unmute failed: Video got paused instead of just unmuted!');
    }
    console.log('First-Click Unmute feature verified successfully! The video is unmuted and remains playing.');

    console.log('--- ALL TESTS COMPLETED SUCCESSFULLY ---');
  } catch (error) {
    console.error('--- TEST FAILED ---');
    console.error(error);
  } finally {
    await browser.close();
  }
})();
