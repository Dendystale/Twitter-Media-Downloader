#!/usr/local/bin/node
const fs = require('fs');
const path = require('path');
const https = require('https');
const { execSync } = require('child_process');

const LOG_FILE = path.join(require('os').homedir(), 'twitter_downloader.log');
const DOWNLOAD_DIR = path.join(require('os').homedir(), 'Downloads', 'TwitterVideos');

function log(msg) {
  try {
    fs.appendFileSync(LOG_FILE, `${new Date().toISOString()}: ${msg}\n`);
  } catch (e) {}
}

const YTDLP_PATH = path.join(__dirname, 'venv', 'bin', 'yt-dlp');

log('Node Native Host Started');

process.stdin.on('readable', () => {
  let chunk;
  while ((chunk = process.stdin.read()) !== null) {
    if (chunk.length < 4) continue;
    const msgLen = chunk.readUInt32LE(0);
    if (chunk.length >= msgLen + 4) {
      const msgBuf = chunk.slice(4, msgLen + 4);
      try {
        const msg = JSON.parse(msgBuf.toString('utf8'));
        log(`Received message: ${JSON.stringify(msg)}`);
        handleMessage(msg);
      } catch (e) {
        log(`JSON Parsing Error: ${e.message}`);
      }
    }
  }
});

function sendMessage(msgObj) {
  const msgStr = JSON.stringify(msgObj);
  const msgBuf = Buffer.from(msgStr, 'utf8');
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32LE(msgBuf.length, 0);
  process.stdout.write(lenBuf);
  process.stdout.write(msgBuf);
}

// Save a companion metadata JSON file next to the downloaded media

// Save a beautiful human-readable HTML file next to the downloaded media
function saveBeautifulHTML(baseFilename, metadata, downloadedFiles) {
  try {
    if (!metadata) return;
    const htmlPath = path.join(DOWNLOAD_DIR, `${baseFilename}.html`);
    
    const mediaHtml = (downloadedFiles || []).map(file => {
      if (file.match(/\.(mp4|webm|mov)/i)) {
        return `<div class="media-item video-item"><video controls src="${file}"></video></div>`;
      } else if (file.match(/\.(jpg|jpeg|png|webp|gif)/i)) {
        return `<div class="media-item image-item"><img src="${file}" alt="Post Image" onclick="window.open(this.src)"></div>`;
      }
      return '';
    }).join('');

    const htmlContent = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Post by @${metadata.handle || 'unknown'}</title>
    <style>
        :root {
            --bg-color: #0f1419;
            --card-bg: #15202b;
            --text-main: #ffffff;
            --text-secondary: #8899a6;
            --accent-color: #1d9bf0;
            --border-color: #38444d;
        }
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
            background-color: var(--bg-color);
            color: var(--text-main);
            display: flex;
            flex-direction: column;
            align-items: center;
            padding: 50px 20px;
            line-height: 1.5;
            min-height: 100vh;
        }
        .container {
            width: 100%;
            max-width: 600px;
            background-color: var(--card-bg);
            border: 1px solid var(--border-color);
            border-radius: 16px;
            overflow: hidden;
            box-shadow: 0 10px 30px rgba(0,0,0,0.5);
            margin: auto 0; /* Vertical centering helper */
        }
        .header {
            padding: 16px;
            border-bottom: 1px solid var(--border-color);
            display: flex;
            flex-direction: column;
            position: relative;
        }
        .author-name { font-weight: bold; font-size: 1.2rem; }
        .author-handle { color: var(--text-secondary); font-size: 0.95rem; }
        .post-date { color: var(--text-secondary); font-size: 0.85rem; margin-top: 2px; }
        .meta-link {
            font-size: 0.85rem;
            color: var(--accent-color);
            text-decoration: none;
            margin-top: 8px;
        }
        .meta-link:hover { text-decoration: underline; }
        .content { padding: 16px; font-size: 1.1rem; white-space: pre-wrap; word-break: break-word; }
        .interactions {
            padding: 12px 16px;
            display: flex;
            gap: 20px;
            border-top: 1px solid var(--border-color);
            border-bottom: 1px solid var(--border-color);
            margin: 0 16px 16px;
            color: var(--text-secondary);
            font-size: 0.9rem;
        }
        .stat b { color: var(--text-main); }
        .media-grid {
            padding: 0 16px 16px;
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 12px;
        }
        .media-item {
            border-radius: 12px;
            overflow: hidden;
            border: 1px solid var(--border-color);
            background: #000;
            display: flex;
            align-items: center;
            justify-content: center;
        }
        .media-item img, .media-item video {
            width: 100%;
            height: auto;
            max-height: 500px;
            object-fit: contain;
            cursor: pointer;
            transition: transform 0.2s;
        }
        .media-item img:hover { transform: scale(1.02); }
        .footer {
            padding: 12px 16px;
            background: rgba(0,0,0,0.1);
            color: var(--text-secondary);
            font-size: 0.8rem;
            text-align: right;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <span class="author-name">${metadata.displayName || metadata.handle || 'Unknown User'}</span>
            <span class="author-handle">@${metadata.handle || 'unknown'}</span>
            <span class="post-date">${metadata.timestamp ? new Date(metadata.timestamp).toLocaleString(undefined, { dateStyle: 'long', timeStyle: 'short' }) : 'Unknown Date'}</span>
            <a href="${metadata.url}" class="meta-link" target="_blank">View on X</a>
            ${metadata.translation ? `
            <button id="toggle-translation-btn" style="position: absolute; top: 16px; right: 16px; background: rgba(29, 155, 240, 0.1); border: 1px solid var(--accent-color); color: var(--accent-color); border-radius: 9999px; padding: 6px 16px; cursor: pointer; font-size: 0.85rem; font-weight: bold; transition: background 0.2s ease;">
                Show Original
            </button>
            ` : ''}
        </div>
        ${metadata.translation ? `
        <div id="translated-text" class="content">${metadata.translation}</div>
        <div id="original-text" class="content" style="display: none;">${metadata.text || 'No text content.'}</div>
        <script>
            const btn = document.getElementById('toggle-translation-btn');
            const transText = document.getElementById('translated-text');
            const origText = document.getElementById('original-text');
            let showingTranslation = true;
            btn.addEventListener('click', () => {
                showingTranslation = !showingTranslation;
                if (showingTranslation) {
                    transText.style.display = 'block';
                    origText.style.display = 'none';
                    btn.innerText = 'Show Original';
                } else {
                    transText.style.display = 'none';
                    origText.style.display = 'block';
                    btn.innerText = 'Show Translation';
                }
            });
            btn.addEventListener('mouseover', () => btn.style.background = 'rgba(29, 155, 240, 0.2)');
            btn.addEventListener('mouseout', () => btn.style.background = 'rgba(29, 155, 240, 0.1)');
        </script>
        ` : `
        <div class="content">${metadata.text || 'No text content.'}</div>
        `}
        
        <div class="media-grid">
            ${mediaHtml}
        </div>

        ${metadata.interactions ? `
        <div class="interactions">
            <span class="stat"><b>${metadata.interactions.replies || 0}</b> Replies</span>
            <span class="stat"><b>${metadata.interactions.retweets || 0}</b> Retweets</span>
            <span class="stat"><b>${metadata.interactions.likes || 0}</b> Likes</span>
        </div>
        ` : ''}
    </div>
</body>
</html>`;

    fs.writeFileSync(htmlPath, htmlContent, 'utf8');
    log(`Saved beautiful post to ${htmlPath}`);
  } catch (e) {
    log(`Failed to save beautiful HTML: ${e.message}`);
  }
}

function handleMessage(msg) {
  if (msg.action === 'ping') {
    sendMessage({ status: 'ok', message: 'Host is alive (Node)' });
    return;
  }
  
  if (msg.action === 'download' && msg.url) {
    if (!fs.existsSync(DOWNLOAD_DIR)) {
      fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });
    }

    // Derive a base filename from the tweet URL
    const urlMatch = msg.url.match(/(?:x|twitter)\.com\/([^/]+)\/status\/(\d+)/);
    const baseFilename = urlMatch
      ? `x.com_${urlMatch[1]}_status_${urlMatch[2]}`
      : `twitter_${Date.now()}`;

    const downloadedFiles = [];
    let ytdlpError = null;

    // --- 1. Download all videos via yt-dlp ---
    // %(autonumber)s ensures each video in a multi-video tweet gets a unique name
    const hasImages = Array.isArray(msg.imageUrls) && msg.imageUrls.length > 0;
    try {
      log(`Running yt-dlp on URL: ${msg.url}`);
      const outTemplate = path.join(DOWNLOAD_DIR, `${baseFilename}_%(autonumber)s.%(ext)s`);
      execSync(
        `"${YTDLP_PATH}" -o "${outTemplate}" -f "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best" "${msg.url}"`,
        { encoding: 'utf8', stdio: 'pipe', timeout: 120000 }
      );
      log(`yt-dlp finished successfully.`);
      
      // Track files created by yt-dlp
      const files = fs.readdirSync(DOWNLOAD_DIR);
      files.forEach(f => {
        if (f.startsWith(baseFilename) && !downloadedFiles.includes(f) && !f.endsWith('.json') && !f.endsWith('.html')) {
          downloadedFiles.push(f);
        }
      });
    } catch (error) {
      const errMsg = ((error.stderr || '') + (error.message || '')).split('\n')[0];
      if (hasImages) {
        // Image-only post: yt-dlp failure is expected and non-fatal
        log(`yt-dlp found no video (image-only post likely): ${errMsg}`);
      } else {
        log(`yt-dlp error: ${errMsg}`);
        ytdlpError = errMsg;
      }
    }


    // --- 2. Download images from imageUrls (sent by content.js) ---
    const imageUrls = Array.isArray(msg.imageUrls) ? msg.imageUrls : [];
    const imagePromises = imageUrls.map((imgUrl, index) => {
      return new Promise((resolve) => {
        try {
          const urlObj = new URL(imgUrl);
          const formatParam = urlObj.searchParams.get('format') || 'jpg';
          const imgFilename = `${baseFilename}_img_${String(index + 1).padStart(2, '0')}.${formatParam}`;
          const imgPath = path.join(DOWNLOAD_DIR, imgFilename);
          const file = fs.createWriteStream(imgPath);
          https.get(imgUrl, (res) => {
            res.pipe(file);
            file.on('finish', () => {
              file.close();
              downloadedFiles.push(imgFilename);
              log(`Downloaded image: ${imgFilename}`);
              resolve();
            });
          }).on('error', (err) => {
            fs.unlink(imgPath, () => {});
            log(`Failed to download image ${imgUrl}: ${err.message}`);
            resolve();
          });
        } catch (e) {
          log(`Error setting up image download: ${e.message}`);
          resolve();
        }
      });
    });

    Promise.all(imagePromises).then(() => {
      // Save beautiful HTML
      saveBeautifulHTML(baseFilename, msg.metadata, downloadedFiles);

      if (ytdlpError && downloadedFiles.length === 0) {
        sendMessage({ status: 'error', message: `Download failed: ${ytdlpError}` });
      } else {
        const count = downloadedFiles.length;
        sendMessage({ status: 'success', message: `Download complete (${count} image${count !== 1 ? 's' : ''} + videos)` });
      }
    });

    return;
  }


  if (msg.action === 'download_post' && msg.url) {
    if (!fs.existsSync(DOWNLOAD_DIR)) {
      fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });
    }

    const urlMatch = msg.url.match(/(?:x|twitter)\.com\/([^/]+)\/status\/(\d+)/);
    const baseFilename = urlMatch
      ? `x.com_${urlMatch[1]}_status_${urlMatch[2]}`
      : `twitter_${Date.now()}`;

    // Save beautiful HTML for text-only posts
    saveBeautifulHTML(baseFilename, msg.metadata, []);

    sendMessage({ status: 'success', message: 'Text post downloaded' });
    return;
  }

  if (msg.action === 'download_images' && Array.isArray(msg.urls)) {
    if (!fs.existsSync(DOWNLOAD_DIR)) {
      fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });
    }

    const urlMatch = (msg.originUrl || '').match(/(?:x|twitter)\.com\/([^/]+)\/status\/(\d+)/);
    const baseFilename = urlMatch
      ? `${urlMatch[1]}_${urlMatch[2]}`
      : `twitter_images_${Date.now()}`;

    log(`Starting download of ${msg.urls.length} images from ${msg.originUrl || 'unknown origin'}...`);
    let downloadedCount = 0;
    let hasError = false;

    const promises = msg.urls.map((url, index) => {
      return new Promise((resolve) => {
        try {
          const urlObj = new URL(url);
          const formatParam = urlObj.searchParams.get('format') || 'jpg';
          const filename = `${baseFilename}_img${index + 1}.${formatParam}`;
          const filepath = path.join(DOWNLOAD_DIR, filename);
          const file = fs.createWriteStream(filepath);
          
          https.get(url, (res) => {
            res.pipe(file);
            file.on('finish', () => {
              file.close();
              downloadedCount++;
              resolve();
            });
          }).on('error', (err) => {
            fs.unlink(filepath, () => {});
            log(`Failed to download image ${url}: ${err.message}`);
            hasError = true;
            resolve();
          });
        } catch (e) {
          log(`Error setting up download for ${url}: ${e.message}`);
          hasError = true;
          resolve(); 
        }
      });
    });

    Promise.all(promises).then(() => {
      // Save beautiful HTML once all images are downloaded
      saveBeautifulHTML(baseFilename, msg.metadata || { url: msg.originUrl, handle: (msg.originUrl || '').match(/x\.com\/([^\/]+)/)?.[1] || 'unknown' }, Array.from({length: downloadedCount}, (_, i) => `${baseFilename}_img${i + 1}.${new URL(msg.urls[i]).searchParams.get('format') || 'jpg'}`));

      if (downloadedCount === msg.urls.length) {
        log(`Successfully downloaded ${downloadedCount} images.`);
        sendMessage({ status: 'success', message: 'All images downloaded' });
      } else {
        sendMessage({ status: 'error', message: `Downloaded ${downloadedCount}/${msg.urls.length} images.` });
      }
    });
  }
}
