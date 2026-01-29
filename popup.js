const domainEl = document.getElementById("domain");

chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
  if (tabs[0] && tabs[0].url) {
    try {
      const hostname = new URL(tabs[0].url).hostname;
      domainEl.textContent = hostname || "(no domain)";
    } catch {
      domainEl.textContent = "(unable to detect)";
    }
  }
});
