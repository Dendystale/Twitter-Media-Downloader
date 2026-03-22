// Function to create our download button
function createDownloadButton() {
  const btn = document.createElement("button");
  btn.className = "twitter-download-btn";
  btn.title = "Download Media to Mac";
  btn.innerHTML = `
    <svg viewBox="0 0 24 24" aria-hidden="true" class="r-4qtqp9 r-yyyyoo r-1xvli5t r-dnmrzs r-bnwqim r-1plcrui r-lrvibr r-1hdv0qi">
      <g><path d="M4 19h16v1.5H4V19zM12 15l5-5h-3V4h-4v6H7l5 5z"></path></g>
    </svg>
  `;
  return btn;
}

// Extract tweet metadata from the article element
function getTweetMetadata(tweetElement) {
  // Tweet text - search for all parts (X splits long posts)
  const textElements = tweetElement.querySelectorAll('[data-testid="tweetText"]');
  const text = textElements.length > 0 
    ? Array.from(textElements).map(el => el.innerText).join('\n\n').trim() 
    : "";

  // Author handle and display name
  const handleEl = tweetElement.querySelector('[data-testid="User-Name"] a[href^="/"]');
  const handle = handleEl ? handleEl.href.replace(/.*\//, '') : "";
  
  const displayNameEl = tweetElement.querySelector('[data-testid="User-Name"] span > span');
  const displayName = displayNameEl ? displayNameEl.innerText.trim() : "";

  // Tweet URL and timestamp
  const timeEl = tweetElement.querySelector('time');
  const timestamp = timeEl ? timeEl.getAttribute('datetime') : "";
  const timeLink = timeEl?.parentElement;
  
  // Strip any trailing path after /status/<id> (e.g. /history, /photo/1)
  const rawUrl = timeLink?.href?.split('?')[0] || window.location.href.split('?')[0];
  const url = rawUrl.replace(/(\/status\/\d+).*$/, '$1');

  // Interaction counts (Likes, Retweets, Replies, Bookmarks)
  const getCount = (testId) => {
    const el = tweetElement.querySelector(`[data-testid="${testId}"]`);
    if (!el) return "0";
    const label = el.getAttribute('aria-label') || "";
    const match = label.match(/\d+/);
    return match ? match[0] : "0";
  };

  const interactions = {
    replies: getCount('reply'),
    retweets: getCount('retweet'),
    likes: getCount('like'),
    bookmarks: getCount('bookmark')
  };

  return { text, handle, displayName, url, timestamp, interactions };
}

// Extract high resolution image URLs
function getImages(tweetElement) {
  const imgs = tweetElement.querySelectorAll('img[src*="format=jpg"], img[src*="format=png"], img[src*="format=webp"]');
  const urls = [];
  imgs.forEach(img => {
    if (img.src.includes('profile_images') || img.src.includes('emoji')) return;
    let highResUrl = img.src.replace(/name=[a-zA-Z0-9]+/, 'name=orig');
    if (!urls.includes(highResUrl)) urls.push(highResUrl);
  });
  return urls;
}

// Find the tweet URL for the media owner (traces up from video element)
function getMediaUrl(tweetElement) {
  const video = tweetElement.querySelector('video');
  if (video) {
    let current = video.parentElement;
    while (current && current !== tweetElement) {
      if (current.tagName === 'A' && current.href && current.href.includes('/status/')) {
        return current.href.split('?')[0];
      }
      current = current.parentElement;
    }
  }
  const timeLink = tweetElement.querySelector('time')?.parentElement;
  if (timeLink && timeLink.href) return timeLink.href.split('?')[0];
  return window.location.href.split('?')[0];
}

function injectButtons() {
  const actionBars = document.querySelectorAll('[role="group"]:not(.download-injected)');
  
  actionBars.forEach(actionBar => {
    actionBar.classList.add('download-injected');
    const tweet = actionBar.closest('article');
    if (!tweet) return;

    const hasMedia = tweet.querySelector('video, img[src*="format="]') !== null;

    const btn = createDownloadButton();
    
    btn.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      
      const images = getImages(tweet);
      const metadata = getTweetMetadata(tweet);
      
      const transContainer = tweet.querySelector('.tweet-translation-container[data-translated="true"]');
      
      if (transContainer) {
        metadata.translation = transContainer.innerHTML.replace(/<br\s*\/?>/ig, '\n');
      } else {
        // Auto-translate if text is eligible but hasn't finished translated yet
        const textElements = tweet.querySelectorAll('[data-testid="tweetText"]');
        if (textElements.length > 0) {
           const lang = textElements[0].getAttribute('lang');
           if (lang && !['en', 'es', 'pt', 'und', 'qme', 'zxx'].includes(lang)) {
             const text = Array.from(textElements).map(el => el.innerText).join('\n\n').trim();
             if (text) {
               try {
                 const response = await new Promise(resolve => {
                   chrome.runtime.sendMessage({ action: "translate", text: text }, resolve);
                 });
                 if (response && response.status === "success") {
                   metadata.translation = response.text;
                 }
               } catch (err) {
                 console.error(err);
               }
             }
           }
        }
      }

      // Always use the canonical tweet URL so yt-dlp can discover ALL videos.
      // Also pass image URLs so the backend can download them alongside.
      const tweetUrl = metadata.url || window.location.href.split('?')[0];
      
      const tweetIdMatch = tweetUrl.match(/\/status\/(\d+)/);
      const tweetId = tweetIdMatch ? tweetIdMatch[1] : "unknown";

      const payload = { 
        action: hasMedia ? "download" : "download_post", 
        url: tweetUrl, 
        imageUrls: images, 
        metadata: metadata,
        tweet_info: {
          handle: metadata.handle || "unknown",
          id: tweetId
        }
      };

      console.log("Download Payload:", payload);
      
      btn.classList.add('downloading');
      btn.querySelector('path').setAttribute('d', 'M12 4V2A10 10 0 0 0 2 12h2a8 8 0 0 1 8-8z'); 

      chrome.runtime.sendMessage(payload, (response) => {
        btn.classList.remove('downloading');
        
        if (chrome.runtime.lastError) {
          btn.classList.add('error');
          alert("Connection to backend lost. Refresh the page.");
          return;
        }

        if (response && response.status === "success") {
          btn.classList.add('success');
          btn.querySelector('path').setAttribute('d', 'M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z');
        } else {
          btn.classList.add('error');
          alert("Error: " + (response ? response.message : "Media inaccessible"));
        }
        
        setTimeout(() => {
          btn.classList.remove('success', 'error');
          btn.innerHTML = `
            <svg viewBox="0 0 24 24" aria-hidden="true" class="r-4qtqp9 r-yyyyoo r-1xvli5t r-dnmrzs r-bnwqim r-1plcrui r-lrvibr r-1hdv0qi">
              <g><path d="M4 19h16v1.5H4V19zM12 15l5-5h-3V4h-4v6H7l5 5z"></path></g>
            </svg>
          `;
        }, 3000);
      });
    });
    
    actionBar.appendChild(btn);
  });
}

function injectTranslateButtons() {
  const textContainers = document.querySelectorAll('[data-testid="tweetText"]:not(.translate-injected)');
  
  textContainers.forEach(textEl => {
    const lang = textEl.getAttribute('lang');
    if (!lang || ['en', 'es', 'pt', 'und', 'qme', 'zxx'].includes(lang)) {
      textEl.classList.add('translate-injected');
      return;
    }

    const tweet = textEl.closest('article');
    if (!tweet) return;

    textEl.classList.add('translate-injected');

    const originalText = textEl.innerText.trim();
    if (!originalText) return;

    const transContainer = document.createElement('div');
    transContainer.className = 'tweet-translation-container';
    transContainer.dir = "ltr";
    transContainer.innerHTML = '<span style="color: #1d9bf0; font-style: italic; font-size: 13px;">Translating...</span>';
    textEl.parentElement.appendChild(transContainer);

    chrome.runtime.sendMessage({ action: "translate", text: originalText }, (response) => {
      if (chrome.runtime.lastError || !response || response.status === "error") {
        console.error("Translation failed");
        transContainer.remove();
        return;
      }
      
      transContainer.setAttribute('data-translated', 'true');
      transContainer.innerHTML = response.text.replace(/\n/g, '<br>');
    });
  });
}

function runInjectors() {
  injectButtons();
  injectTranslateButtons();
}

setInterval(runInjectors, 2000);
