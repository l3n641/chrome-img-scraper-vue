// src/content.ts

// 定义返回的数据类型结构
export interface ScrapeResult {
    success: boolean;
    data?: string[];
    error?: string;
}

// 建议设置一个唯一的消息来源标识，避免误触页面其他 postMessage
const MESSAGE_SOURCE = 'MY_SCRAPER_SNIPPET';

interface CustomMessageEvent {
    source: string;
    type: string;
    payload: ScrapeResult;
}

// 监听来自网页 Main World (控制台/代码段/宿主脚本) 的消息
window.addEventListener('message', (event: MessageEvent<CustomMessageEvent>) => {
    // 只接收来自当前窗口且符合我们特定标识的消息
    if (event.source !== window) return;
    if (event.data?.source !== MESSAGE_SOURCE) return;

    if (event.data.type === 'SCRAPE_RESULT') {
        const scrapeData: ScrapeResult = event.data.payload;

        console.log('[Content Script] 收到控制台/代码段数据，准备转发给侧边栏:', scrapeData);

        // 转发给 Extension Runtime (侧边栏/Background)
        chrome.runtime.sendMessage(
            {
                action: 'FROM_PAGE_SCRAPE_RESULT',
                payload: scrapeData,
            },
            (response) => {
                if (chrome.runtime.lastError) {
                    console.warn(
                        '[Content Script] 侧边栏可能未打开或尚未建立消息监听:',
                        chrome.runtime.lastError.message
                    );
                } else {
                    console.log('[Content Script] 成功发送至侧边栏，侧边栏响应:', response);
                }
            }
        );
    }
});