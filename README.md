# Twitter Media Downloader

A Chrome/Edge extension and Python native host for downloading media (videos and images) from X (Twitter).

## Components
- **Browser Extension**: A content script that adds download buttons to tweets and communicates with the native host.
- **Native Host**: A Python/Node script that uses `yt-dlp` to download media to your local machine.

## Setup
1. Install the Python dependencies: `pip install -r requirements.txt`
2. Run `install_host.sh` to register the native messaging host.
3. Load the `extension/` folder as an unpacked extension in your browser.
