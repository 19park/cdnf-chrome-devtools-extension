const tabPorts = new Map();

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "net-filter") return;

  let tabId = null;

  port.onMessage.addListener((msg) => {
    if (msg.type === "init") {
      tabId = msg.tabId;
      tabPorts.set(tabId, port);
    }
  });

  port.onDisconnect.addListener(() => {
    if (tabId !== null) tabPorts.delete(tabId);
  });
});

chrome.webRequest.onBeforeRequest.addListener(
  (details) => {
    const port = tabPorts.get(details.tabId);
    if (port) {
      port.postMessage({
        type: "start",
        requestId: details.requestId,
        url: details.url,
        method: details.method,
        resourceType: details.type,
        timeStamp: details.timeStamp,
      });
    }
  },
  { urls: ["<all_urls>"] }
);

chrome.webRequest.onCompleted.addListener(
  (details) => {
    const port = tabPorts.get(details.tabId);
    if (port) {
      port.postMessage({
        type: "end",
        requestId: details.requestId,
        statusCode: details.statusCode,
        fromCache: details.fromCache,
      });
    }
  },
  { urls: ["<all_urls>"] }
);

chrome.webRequest.onErrorOccurred.addListener(
  (details) => {
    const port = tabPorts.get(details.tabId);
    if (port) {
      port.postMessage({
        type: "error",
        requestId: details.requestId,
        error: details.error,
      });
    }
  },
  { urls: ["<all_urls>"] }
);
