// npm installs the JS runtime first. The explicit browser installer downloads
// Chrome later without blocking app startup; its CLI still accepts install chrome.
module.exports = {skipDownload: true};
