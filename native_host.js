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
function saveMetadata(baseFilename, metadata, extraFields) {
  try {
    if (!metadata) return;
    const jsonPath = path.join(DOWNLOAD_DIR, `${baseFilename}.json`);
    const data = Object.assign({
      downloaded_at: new Date().toISOString(),
      url: metadata.url || '',
      author: metadata.displayName || metadata.handle || '',
      handle: metadata.handle || '',
      text: metadata.text || '',
      timestamp: metadata.timestamp || ''
    }, extraFields || {});
    fs.writeFileSync(jsonPath, JSON.stringify(data, null, 2), 'utf8');
    log(`Saved metadata to ${jsonPath}`);
  } catch (e) {
    log(`Failed to save metadata: ${e.message}`);
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
      // Save companion metadata
      saveMetadata(baseFilename, msg.metadata, { media_url: msg.url, type: 'mixed', images_downloaded: downloadedFiles.length });

      if (ytdlpError && downloadedFiles.length === 0) {
        sendMessage({ status: 'error', message: `Download failed: ${ytdlpError}` });
      } else {
        const count = downloadedFiles.length;
        sendMessage({ status: 'success', message: `Download complete (${count} image${count !== 1 ? 's' : ''} + videos)` });
      }
    });

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
      // Save companion metadata once all images are downloaded
      saveMetadata(baseFilename, msg.metadata || { url: msg.originUrl }, {
        type: 'images',
        image_urls: msg.urls,
        images_downloaded: downloadedCount,
        total_images: msg.urls.length
      });

      if (downloadedCount === msg.urls.length) {
        log(`Successfully downloaded ${downloadedCount} images.`);
        sendMessage({ status: 'success', message: 'All images downloaded' });
      } else {
        sendMessage({ status: 'error', message: `Downloaded ${downloadedCount}/${msg.urls.length} images.` });
      }
    });
  }
}
