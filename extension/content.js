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
  // Tweet text
  const textEl = tweetElement.querySelector('[data-testid="tweetText"]');
  const text = textEl ? textEl.innerText.trim() : "";

  // Author handle and display name
  const handleEl = tweetElement.querySelector('[data-testid="User-Name"] a[href^="/"]');
  const handle = handleEl ? handleEl.href.replace(/.*\//, '') : "";
  
  const displayNameEl = tweetElement.querySelector('[data-testid="User-Name"] span > span');
  const displayName = displayNameEl ? displayNameEl.innerText.trim() : "";

  // Tweet URL and timestamp
  const timeLink = tweetElement.querySelector('time')?.parentElement;
  // Strip any trailing path after /status/<id> (e.g. /history, /photo/1)
  const rawUrl = timeLink?.href?.split('?')[0] || window.location.href.split('?')[0];
  const url = rawUrl.replace(/(\/status\/\d+).*$/, '$1');
  const timestamp = tweetElement.querySelector('time')?.getAttribute('datetime') || "";

  return { text, handle, displayName, url, timestamp };
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

    const hasMedia = tweet.querySelector('video, img[src*="format="]');
    if (!hasMedia) return;

    const btn = createDownloadButton();
    
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      
      const images = getImages(tweet);
      const metadata = getTweetMetadata(tweet);
      
      // Always use the canonical tweet URL so yt-dlp can discover ALL videos.
      // Also pass image URLs so the backend can download them alongside.
      const tweetUrl = metadata.url || window.location.href.split('?')[0];
      const payload = { action: "download", url: tweetUrl, imageUrls: images, metadata };

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

setInterval(injectButtons, 2000);
