// 显式为 tab 声明 chrome.tabs.Tab 类型
chrome.action.onClicked.addListener((tab: chrome.tabs.Tab) => {
    if (tab.id) {
        chrome.sidePanel.open({ tabId: tab.id });
    }
});
