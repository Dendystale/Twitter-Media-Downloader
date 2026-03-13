import sys
import yt_dlp

def download_twitter_video(url: str):
    print(f"Preparing to download from: {url}")
    
    # Try to extract handle and id from URL for a better filename
    import re
    match = re.search(r'(?:x|twitter)\.com/([^/]+)/status/(\d+)', url)
    if match:
        filename = f"x.com_{match.group(1)}_status_{match.group(2)}.%(ext)s"
    else:
        filename = "video_%(id)s.%(ext)s"

    # Configuration for yt-dlp
    ydl_opts = {
        # Save as video title and extension
        'outtmpl': filename,
        # Prefer mp4 formatted video
        'format': 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best',
        # No warnings
        'quiet': False,
        'no_warnings': True,
    }
    
    # Download using yt-dlp
    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            ydl.download([url])
            print("Download completed successfully!")
    except Exception as e:
        print(f"Failed to download video. Error: {e}")

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python downloader.py <twitter_url>")
        sys.exit(1)
        
    twitter_url = sys.argv[1]
    download_twitter_video(twitter_url)
