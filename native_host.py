#!/usr/bin/env python3
import sys
import json
import struct
import os
import yt_dlp
import traceback
import base64

# Setup a log file since stdout is used for Native Messaging protocol
LOG_FILE = os.path.expanduser("~/twitter_downloader.log")

def log(msg):
    with open(LOG_FILE, "a") as f:
        f.write(f"{msg}\n")

# Native messaging uses stdin/stdout to read/write 4-byte message lengths followed by JSON
def get_message():
    try:
        raw_length = sys.stdin.buffer.read(4)
        if len(raw_length) == 0:
            return None
        message_length = struct.unpack('@I', raw_length)[0]
        message = sys.stdin.buffer.read(message_length).decode('utf-8')
        if not message:
            return None
        return json.loads(message)
    except Exception as e:
        log(f"Failed to parse incoming message: {str(e)}")
        sys.exit(0) # Extension disconnected or invalid data, just exit cleanly

def send_message(msg_dict):
    encoded_content = json.dumps(msg_dict).encode('utf-8')
    sys.stdout.buffer.write(struct.pack('@I', len(encoded_content)))
    sys.stdout.buffer.write(encoded_content)
    sys.stdout.buffer.flush()

def download_all_media(url, image_urls, output_dir):
    """Download all videos from a tweet URL (handles multiple videos as a playlist)
    and separately download any image URLs provided by the extension."""
    import re
    import urllib.request

    log(f"Starting full media download for {url} to {output_dir}")
    os.makedirs(output_dir, exist_ok=True)

    downloaded_files = []
    errors = []

    # --- Build the filename template from the tweet URL ---
    match = re.search(r'(?:x|twitter)\.com/([^/]+)/status/(\d+)', url)
    handle = match.group(1) if match else "unknown"
    tweet_id = match.group(2) if match else "unknown"
    base = f"x.com_{handle}_status_{tweet_id}"

    # --- 1. Use yt-dlp to download ALL videos ---
    # Use %(autonumber)s so multiple videos get unique filenames automatically.
    ydl_opts = {
        'outtmpl': os.path.join(output_dir, f"{base}_%(autonumber)s.%(ext)s"),
        'format': 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best',
        'quiet': True,
        'no_warnings': True,
    }

    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(url, download=True)
            # Handle both single videos and playlists (multiple videos)
            entries = info.get('entries') if info.get('_type') == 'playlist' else [info]
            for entry in entries:
                if entry:
                    fname = ydl.prepare_filename(entry)
                    downloaded_files.append(os.path.basename(fname))
                    log(f"Downloaded video: {fname}")
    except yt_dlp.utils.DownloadError as e:
        msg = str(e)
        # If there are no videos at all (image-only post), yt-dlp may error — that's OK
        if "No video" in msg or "Unable to download" in msg:
            log(f"No videos found (may be image-only post): {msg}")
        else:
            log(f"yt-dlp error: {msg}")
            errors.append(msg)
    except Exception as e:
        log(f"Error downloading videos: {str(e)}")
        log(traceback.format_exc())
        errors.append(str(e))

    # --- 2. Download images detected by the extension ---
    for i, img_url in enumerate(image_urls or []):
        try:
            # Force the highest resolution variant Twitter allows
            img_url_hires = re.sub(r'name=[a-zA-Z0-9]+', 'name=orig', img_url)
            ext = "jpg"
            if "format=png" in img_url_hires:
                ext = "png"
            elif "format=webp" in img_url_hires:
                ext = "webp"
            img_filename = f"{base}_img_{i+1:02d}.{ext}"
            img_path = os.path.join(output_dir, img_filename)
            log(f"Downloading image: {img_url_hires}")
            urllib.request.urlretrieve(img_url_hires, img_path)
            downloaded_files.append(img_filename)
            log(f"Saved image: {img_path}")
        except Exception as e:
            log(f"Failed to download image {img_url}: {e}")
            errors.append(str(e))

    if downloaded_files:
        return True, downloaded_files, errors
    else:
        return False, [], errors

def process_post_download(msg, output_dir):
    log("Processing full post download")
    os.makedirs(output_dir, exist_ok=True)
    
    tweet_info = msg.get("tweet_info", {})
    handle = tweet_info.get("handle", "unknown")
    tweet_id = tweet_info.get("id", "unknown")
    base_filename = f"x.com_{handle}_status_{tweet_id}"
    
    results = {"media_files": []}
    
    # 1. Save screenshot if available
    b64_img = msg.get("screenshot_base64")
    if b64_img and b64_img.startswith("data:image"):
        try:
            # Remove header "data:image/png;base64,"
            header, encoded = b64_img.split(",", 1)
            img_data = base64.b64decode(encoded)
            img_path = os.path.join(output_dir, f"{base_filename}.png")
            with open(img_path, "wb") as f:
                f.write(img_data)
            results["screenshot"] = f"{base_filename}.png"
            log(f"Saved screenshot to {img_path}")
        except Exception as e:
            log(f"Failed to save screenshot: {e}")
            
    # 2. Download media via download_all_media (handles videos + images)
    media_urls = msg.get("media_urls", [])
    media_type = msg.get("media_type")
    image_urls = msg.get("imageUrls", [])

    log("Downloading all media for post...")
    success, files, errs = download_all_media(
        msg.get("url", ""), image_urls, output_dir
    )
    results["media_files"] = files
    
    # 3. Save JSON metadata
    json_path = os.path.join(output_dir, f"{base_filename}.json")
    metadata = {
        "url": msg.get("url"),
        "handle": handle,
        "id": tweet_id,
        "text": msg.get("text", ""),
        "media_type": media_type,
        "media_urls": media_urls,
        "local_files": results
    }
    try:
        with open(json_path, "w", encoding="utf-8") as f:
            json.dump(metadata, f, indent=4)
        results["metadata"] = f"{base_filename}.json"
        log(f"Saved metadata to {json_path}")
    except Exception as e:
        log(f"Failed to save metadata: {e}")
        
    return True, results

if __name__ == '__main__':
    log("Native host started")
    # Tell yt-dlp to output to the exact same folder as the script by default
    SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
    
    # Alternatively, default to the user's Downloads folder if preferred
    DOWNLOAD_DIR = os.path.expanduser("~/Downloads/TwitterVideos")
    
    try:
        while True:
            # Wait for message from browser extension
            msg = get_message()
            if msg is None:
                log("Received EOF from browser, exiting.")
                break
                
            log(f"Received message: {msg}")
            
            action = msg.get("action")
            url = msg.get("url")
            
            if action == "ping":
                send_message({"status": "ok", "message": "Host is alive"})
            elif action == "download" and url:
                send_message({"status": "downloading", "message": f"Starting download for {url}"})

                image_urls = msg.get("imageUrls", [])
                success, files, errors = download_all_media(url, image_urls, DOWNLOAD_DIR)

                if success:
                    send_message({
                        "status": "success",
                        "message": f"Download complete ({len(files)} file(s))",
                        "files": files
                    })
                else:
                    send_message({
                        "status": "error",
                        "message": f"Download failed: {'; '.join(errors) if errors else 'No media found'}"
                    })
            elif action == "download_post" and url:
                send_message({"status": "downloading", "message": f"Starting post capture for {url}"})
                success, results = process_post_download(msg, DOWNLOAD_DIR)
                if success:
                    send_message({
                        "status": "success", 
                        "message": "Post capture complete", 
                        "files": results
                    })
                else:
                    send_message({
                        "status": "error", 
                        "message": f"Post capture failed"
                    })
            else:
                 send_message({"status": "error", "message": "Unknown action or missing url"})
                 
    except Exception as e:
        log(f"Fatal error: {e}")
        log(traceback.format_exc())
        sys.exit(1)
