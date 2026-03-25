// Extract text from element, preserving emojis (which X renders as <img> tags)
function extractTextWithEmojis(element) {
  let text = '';
  for (const node of element.childNodes) {
    if (node.nodeType === Node.TEXT_NODE) {
      text += node.textContent;
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      if (node.tagName === 'IMG' && node.alt) {
        text += node.alt;
      } else {
        text += extractTextWithEmojis(node);
      }
    }
  }
  return text;
}

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
    ? Array.from(textElements).map(el => extractTextWithEmojis(el)).join('\n\n').trim() 
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
      
      const transContainer = tweet.querySelector('.tweet-translation-node[data-translated="true"]');
      
      if (transContainer) {
        metadata.translation = transContainer.innerHTML.replace(/<br\s*\/?>/ig, '\n');
      } else {
        // Auto-translate if text is eligible but hasn't finished translated yet
        const textElements = tweet.querySelectorAll('[data-testid="tweetText"]');
        if (textElements.length > 0) {
           const lang = textElements[0].getAttribute('lang');
           if (lang && !['en', 'es', 'pt', 'und', 'qme', 'zxx'].includes(lang)) {
             const text = Array.from(textElements).map(el => extractTextWithEmojis(el)).join('\n\n').trim();
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
  const allTextContainers = document.querySelectorAll('[data-testid="tweetText"]');
  
  allTextContainers.forEach(textEl => {
    const originalText = extractTextWithEmojis(textEl).trim();
    if (!originalText) return;

    const lang = textEl.getAttribute('lang');
    if (!lang || ['en', 'es', 'pt', 'und', 'qme', 'zxx'].includes(lang)) {
      return;
    }

    const injectedLen = textEl.getAttribute('data-translated-len');
    if (injectedLen === originalText.length.toString()) {
      return; // Already translated this exact text
    }

    const tweet = textEl.closest('article');
    if (!tweet) return;

    textEl.classList.add('translate-injected');
    textEl.setAttribute('data-translated-len', originalText.length.toString());

    // 1. Setup Toggle Button
    let btn = tweet.querySelector('.twitter-translate-btn');
    if (!btn) {
      btn = document.createElement("button");
      btn.className = "twitter-translate-btn translating";
      btn.title = "Toggle Translation";
      btn.innerHTML = `
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <g><path d="M12.87 15.07l-2.54-2.51.03-.03A17.52 17.52 0 0014.07 6H17V4h-7V2H8v2H1v2h11.17C11.5 7.92 10.44 9.75 9 11.35 8.07 10.32 7.3 9.19 6.69 8h-2c.73 1.63 1.73 3.17 2.98 4.56l-5.09 5.02L4 19l5-5 3.11 3.11.76-2.04zM18.5 10h-2L12 22h2l1.12-3h4.75L21 22h2l-4.5-12zm-2.62 7l1.62-4.33L19.12 17h-3.24z"></path></g>
        </svg>
      `;

      const caret = tweet.querySelector('[data-testid="caret"]');
      if (caret && caret.parentElement) {
        if (window.getComputedStyle(caret.parentElement).display !== 'flex') {
          caret.parentElement.style.display = 'flex';
        }
        caret.parentElement.style.alignItems = 'center';
        caret.parentElement.appendChild(btn);
      } else {
        btn.style.position = 'absolute';
        btn.style.top = '12px';
        btn.style.right = '48px';
        tweet.style.position = tweet.style.position || 'relative';
        tweet.appendChild(btn);
      }

      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        
        if (btn.classList.contains('translating')) return;

        const transNode = tweet.querySelector('.tweet-translation-node');
        if (!transNode) return;

        if (btn.classList.contains('active')) {
          transNode.style.display = 'none';
          textEl.style.display = '';
          btn.classList.remove('active');
        } else {
          textEl.style.display = 'none';
          transNode.style.display = '';
          btn.classList.add('active');
        }
      });
    } else {
      btn.classList.add('translating');
    }

    // 2. Setup Translation Node
    let transNode = tweet.querySelector('.tweet-translation-node');
    if (!transNode) {
      transNode = document.createElement('div');
      transNode.className = 'tweet-translation-node';
      transNode.dir = "ltr";
      
      const computed = window.getComputedStyle(textEl);
      transNode.style.fontSize = computed.fontSize;
      transNode.style.lineHeight = computed.lineHeight;
      transNode.style.color = computed.color;
      transNode.style.fontFamily = computed.fontFamily;
      transNode.style.whiteSpace = 'pre-wrap';
      transNode.style.wordBreak = 'break-word';
      transNode.style.display = 'none'; // hide until loading finishes
      
      textEl.parentElement.insertBefore(transNode, textEl.nextSibling);
    }
    
    transNode.removeAttribute('data-translated');

    chrome.runtime.sendMessage({ action: "translate", text: originalText }, (response) => {
      btn.classList.remove('translating');
      
      if (chrome.runtime.lastError || !response || response.status === "error") {
        console.error("Translation failed");
        return;
      }
      
      transNode.setAttribute('data-translated', 'true');
      transNode.innerHTML = response.text.replace(/\n/g, '<br>');
      
      textEl.style.display = 'none';
      transNode.style.display = '';
      btn.classList.add('active');
    });
  });
}

function runInjectors() {
  injectButtons();
  injectTranslateButtons();
  injectSidebarToggle();
}

function injectSidebarToggle() {
  if (document.querySelector('.twitter-sidebar-toggle-btn.floating')) return;

  const btn = document.createElement('button');
  btn.className = 'twitter-sidebar-toggle-btn floating';
  btn.title = 'Toggle Full Screen';
  btn.innerHTML = `
    <svg viewBox="0 0 24 24" aria-hidden="true" style="width: 24px; height: 24px;">
      <g><path d="M6 14H4v6h6v-2H6v-4zM20 4h-6v2h4v4h2V4zM4 10h2V6h4V4H4v6zm16 4h-2v4h-4v2h6v-6z"></path></g>
    </svg>
  `;

  chrome.storage.local.get(['hideSidebar'], (result) => {
    if (result.hideSidebar) {
      document.body.classList.add('hide-x-sidebar');
      btn.classList.add('active');
    } else {
      document.body.classList.remove('hide-x-sidebar');
      btn.classList.remove('active');
    }
  });

  btn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    
    // Find the currently most visible post
    const articles = Array.from(document.querySelectorAll('article[data-testid="tweet"]'));
    let targetArticle = null;
    let targetOffset = 0;

    for (const article of articles) {
      const rect = article.getBoundingClientRect();
      // Heuristic: top is in the top half of the screen, or it spans across the top quarter
      if (rect.top >= 0 && rect.top <= window.innerHeight / 2) {
        targetArticle = article;
        targetOffset = rect.top;
        break;
      } else if (rect.top < 0 && rect.bottom > window.innerHeight / 4) {
        targetArticle = article;
        targetOffset = rect.top;
        break;
      }
    }

    const isHidden = document.body.classList.toggle('hide-x-sidebar');
    btn.classList.toggle('active', isHidden);
    chrome.storage.local.set({ hideSidebar: isHidden });

    // Restore scroll position gracefully
    if (targetArticle) {
      const startTime = Date.now();
      
      const enforceScroll = () => {
        // Stop if the article was unmounted entirely
        if (!document.contains(targetArticle)) return;
        
        const newRect = targetArticle.getBoundingClientRect();
        const diff = newRect.top - targetOffset;
        
        // Correct scroll by the difference if layout shifted it
        if (Math.abs(diff) > 1) {
          window.scrollBy(0, diff);
        }
        
        // Keep enforcing for a short time to allow React layout and virtualization to settle
        if (Date.now() - startTime < 800) {
          requestAnimationFrame(enforceScroll);
        }
      };
      
      requestAnimationFrame(enforceScroll);
      // Trigger resize to help virtualized lists recalculate heights faster
      window.dispatchEvent(new Event('resize'));
    }
  });

  document.body.appendChild(btn);
}

setInterval(runInjectors, 2000);
