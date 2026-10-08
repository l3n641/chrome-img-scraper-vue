import {
    scrapeCSS,
    initImageObserver,
    stopImageObserver,
    startScrollScrape,
    stopScrollScrape,
    stopAllScrapers,
    clearScrapedMarks,
    type ScrapeResult
} from './utils';

// 导出返回的数据类型结构
export type { ScrapeResult };

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


chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    // 识别是不是侧边栏发来的特定命令
    if (message.action === 'START_SCRAPE_FROM_SIDEBAR') {
        console.log('[Content Script] 收到侧边栏指令:', message.payload);

        const {command, args} = message.payload;
        switch (command) {
            case "scrapeCSS": {
                // 1-单次抓取：停止其他可能运行的定时器/监听器，执行一次 scrapeCSS
                stopAllScrapers();
                const result = scrapeCSS(args.selector, args.selectorAttribute, document, args.markScraped);
                console.log('[Content Script] scrapeCSS 结果:', result);
                sendResponse(result);
                break;
            }
            case "startScrollScrape": {
                // 2-定时器滚动滚动条抓取：先停止 observer，开始滚动并周期抓取
                stopImageObserver();
                const result = startScrollScrape(
                    Number(args.scrollPixels) || 500,
                    Number(args.scrollInterval) || 1000,
                    args.selector,
                    args.selectorAttribute,
                    args.markScraped,
                    undefined,
                    (scrollResult) => {
                        // 每次定时滚动抓取后将结果发送给侧边栏
                        chrome.runtime.sendMessage(
                            {
                                action: 'FROM_PAGE_SCRAPE_RESULT',
                                payload: scrollResult,
                            },
                            () => {
                                if (chrome.runtime.lastError) {
                                    // 侧边栏可能已关闭，自动停止滚动定时器
                                    stopScrollScrape();
                                }
                            }
                        );
                    }
                );
                console.log('[Content Script] startScrollScrape 初始结果:', result);
                sendResponse(result);
                break;
            }
            case "initImageObserver": {
                // 3-监听节点容器：先停止滚动定时器，初始化节点监听
                stopScrollScrape();
                const result = initImageObserver(args.listenNode, args.selector, args.selectorAttribute, args.markScraped);
                console.log('[Content Script] initImageObserver 初始结果:', result);
                sendResponse(result);
                break;
            }
            case "stopScroll": {
                stopScrollScrape();
                sendResponse({success: true, message: '已停止滚动'});
                break;
            }
            case "stopObserver": {
                stopImageObserver();
                sendResponse({success: true, message: '已停止监听'});
                break;
            }
            case "stopAll": {
                stopAllScrapers();
                sendResponse({success: true, message: '已停止所有抓取任务'});
                break;
            }
            case "clearMarks": {
                const result = clearScrapedMarks();
                console.log('[Content Script] clearMarks 结果:', result);
                sendResponse(result);
                break;
            }
        }
    }

    return true;
});