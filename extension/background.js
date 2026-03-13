const NATIVE_HOST_NAME = "com.joaosemedo.twitter_downloader";

// Listen for messages from the content script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "download" || request.action === "download_images" || request.action === "download_post") {
    console.log("Received download request:", request);
    
    // Forward the download request to the Native Node App
    chrome.runtime.sendNativeMessage(
      NATIVE_HOST_NAME,
      request,
      (response) => {
        if (chrome.runtime.lastError) {
          console.error("Native Messaging Error:", chrome.runtime.lastError.message);
          sendResponse({ status: "error", message: chrome.runtime.lastError.message });
          return;
        }
        
        console.log("Response from Native Host:", response);
        sendResponse(response);
      }
    );
    
    // Return true to indicate we will send a response asynchronously
    return true; 
  }
});
