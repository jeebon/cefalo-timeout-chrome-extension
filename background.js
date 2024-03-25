chrome.runtime.onInstalled.addListener(function () {
  console.log("Extension installed or updated");
});

// Listen for messages from content scripts or other parts of the extension
chrome.runtime.onMessage.addListener(function (message, sender, sendResponse) {
  console.log("Message received:", message);
});

// Perform some task when the browser starts
chrome.runtime.onStartup.addListener(function () {
  console.log("Browser started");
});
