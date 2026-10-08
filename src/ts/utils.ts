export interface ScrapeResult {
    success: boolean;
    data?: string[];
    error?: string;
    message?: string;
}

let currentObserver: MutationObserver | null = null;
let currentScrollTimer: any = null;

/**
 * 停止当前运行的 MutationObserver
 */
export function stopImageObserver() {
    if (currentObserver) {
        currentObserver.disconnect();
        currentObserver = null;
        console.log('[Observer] 监听已停止');
    }
}

/**
 * 停止当前运行的滚动定时器
 */
export function stopScrollScrape() {
    if (currentScrollTimer) {
        clearInterval(currentScrollTimer);
        currentScrollTimer = null;
        console.log('[ScrollScrape] 定时滚动抓取已停止');
    }
}

/**
 * 停止所有正在运行的抓取任务（MutationObserver 与 定时滚动）
 */
export function stopAllScrapers() {
    stopImageObserver();
    stopScrollScrape();
}

/**
 * 统一将 URL（相对路径、协议相对路径）转换为绝对路径
 */
export function toAbsoluteUrl(url: string): string {
    if (!url || !url.trim()) return '';
    const trimmed = url.trim();
    // base64 或 blob 链接保持原样
    if (trimmed.startsWith('data:') || trimmed.startsWith('blob:')) {
        return trimmed;
    }
    try {
        return new URL(trimmed, window.location.href).href;
    } catch {
        return trimmed;
    }
}

export const DEFAULT_MARK_CLASS = 'qf-scraped-item';

/**
 * 清除页面中已遍历元素上的标记类
 */
export function clearScrapedMarks(markClass: string = DEFAULT_MARK_CLASS) {
    try {
        const elements = document.querySelectorAll(`.${markClass}`);
        elements.forEach((el) => {
            el.classList.remove(markClass);
        });
        return {success: true, message: `已清除 ${elements.length} 个元素的标记`};
    } catch (error: any) {
        return {success: false, error: error.message};
    }
}

/**
 * 根据 CSS 选择器提取指定属性
 */
export function scrapeCSS(
    cssSelector: string,
    attributeName: string = 'src',
    root: Document | Element = document,
    markScraped: boolean = false,
    markClass: string = DEFAULT_MARK_CLASS,
) {
    const results: string[] = [];
    try {
        if (!cssSelector?.trim()) return {success: true, data: results};
        const attr = attributeName?.trim() || 'src';

        // 提取单个元素的指定属性并转为绝对路径
        const extractAttr = (element: Element) => {
            // 如果开启标记且元素已拥有标记类，则跳过不重复处理，避免页面卡顿
            if (markScraped && element.classList?.contains(markClass)) {
                return;
            }

            const val = element.getAttribute(attr);
            if (val) {
                const absolute = toAbsoluteUrl(val);
                if (absolute) results.push(absolute);
            }

            // 为已遍历的元素添加标记类
            if (markScraped && element.classList) {
                element.classList.add(markClass);
            }
        };

        // 1. 处理 root 本身就匹配 cssSelector 的情况
        if (root instanceof Element && root.matches(cssSelector)) {
            extractAttr(root);
        }

        // 2. 搜索内部符合 cssSelector 的节点
        const nodes = root.querySelectorAll(cssSelector);
        nodes.forEach(extractAttr);

        // 去重并返回
        return {success: true, data: Array.from(new Set(results))};
    } catch (error: any) {
        return {success: false, error: error.message, data: []};
    }
}

/**
 * 动态监听函数：监听新节点并提取图片
 */
export function initImageObserver(
    listenSelector: string,
    targetCssSelector: string,
    attributeName: string = 'src',
    markScraped: boolean = false,
    markClass: string = DEFAULT_MARK_CLASS,
) {
    // 启动前先停止之前的 observer，避免重复挂载
    stopImageObserver();

    // 优先使用用户指定的监听容器，否则默认监听 document.body
    const container = (listenSelector?.trim() ? document.querySelector(listenSelector.trim()) : null) || document.body;
    if (!container) {
        return {success: false, error: '未找到监听容器节点', data: []};
    }

    const recordedUrls = new Set<string>();

    const extractFromNode = (node: Element): string[] => {
        const targets: Element[] = [];
        if (listenSelector?.trim()) {
            if (node.matches && node.matches(listenSelector)) {
                targets.push(node);
            }
            if (node.querySelectorAll) {
                targets.push(...Array.from(node.querySelectorAll(listenSelector)));
            }
        } else {
            targets.push(node);
        }

        const nodeResults: string[] = [];
        targets.forEach(target => {
            const res = scrapeCSS(targetCssSelector, attributeName, target, markScraped, markClass);
            if (res.success && res.data) {
                nodeResults.push(...res.data);
            }
        });

        return nodeResults;
    };

    // 1. 首次全量扫描已有的 targetCssSelector 节点
    const initialRes = scrapeCSS(targetCssSelector, attributeName, container, markScraped, markClass);
    const initialData = initialRes.data || [];
    initialData.forEach(url => recordedUrls.add(url));

    // 2. 建立 MutationObserver 监听后续动态追加的节点
    currentObserver = new MutationObserver((mutationsList) => {
        const newData: string[] = [];

        for (const mutation of mutationsList) {
            if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
                mutation.addedNodes.forEach((node) => {
                    if (node.nodeType !== Node.ELEMENT_NODE) return;
                    const urls = extractFromNode(node as Element);
                    urls.forEach(url => {
                        if (!recordedUrls.has(url)) {
                            recordedUrls.add(url);
                            newData.push(url);
                        }
                    });
                });
            }
        }

        // 保留用户通过控制台或这里 postMessage 通信的机制
        if (newData.length > 0) {
            window.postMessage({
                source: 'MY_SCRAPER_SNIPPET',
                type: 'SCRAPE_RESULT',
                payload: {
                    success: true,
                    data: Array.from(new Set(newData))
                }
            }, '*');
        }
    });

    currentObserver.observe(container, {
        childList: true,
        subtree: true,
    });

    return {success: true, data: Array.from(new Set(initialData))};
}

/**
 * 定时滚动抓取：每次先执行滚动，然后执行 scrapeCSS
 */
export function startScrollScrape(
    scrollPixels: number = 500,
    scrollInterval: number = 1000,
    cssSelector: string,
    attributeName: string = 'src',
    markScraped: boolean = false,
    markClass: string = DEFAULT_MARK_CLASS,
    onResult?: (result: ScrapeResult) => void
): ScrapeResult {
    // 启动前先停止之前的定时器，防止重复执行
    stopScrollScrape();

    const doScrollAndScrape = (): ScrapeResult => {
        try {
            // 1. 先执行滚动
            window.scrollBy(0, scrollPixels);

            // 2. 滚动后执行 scrapeCSS
            const res = scrapeCSS(cssSelector, attributeName, document, markScraped, markClass);
            if (onResult && res.success && res.data) {
                onResult(res);
            }
            return res;
        } catch (error: any) {
            const errRes: ScrapeResult = { success: false, error: error.message, data: [] };
            if (onResult) {
                onResult(errRes);
            }
            return errRes;
        }
    };

    // 首次先执行一次滚动后抓取
    const initialResult = doScrollAndScrape();

    // 启动周期定时器
    const interval = Math.max(Number(scrollInterval) || 1000, 100);
    currentScrollTimer = setInterval(() => {
        doScrollAndScrape();
    }, interval);

    return initialResult;
}