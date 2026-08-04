export function scrapeCSS(
    cssSelector: string,
    attributeName: string,
    root: Document | Element = document,
) {
    const results: string[] = [];
    try {
        console.log(cssSelector, attributeName)
        if (!cssSelector?.trim()) return {success: true, data: results};

        // 提取单个元素的指定属性
        const extractAttr = (element: Element) => {
            const val = element.getAttribute(attributeName);
            if (val) results.push(val);
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
 * 动态监听函数
 */
export function initImageObserver(
    listenSelector: string,
    targetCssSelector: string,
    attributeName: string,
) {
    const container = document.querySelector('#contentScrollPaginator') || document.body;
    console.log(1)
    if (!container) {
        setTimeout(() => initImageObserver(listenSelector, targetCssSelector, attributeName), 500);
        return {success: true, message: '等待容器加载后初始化 Observer'};
    }

    const extractFromNode = (node: Element): string[] => {
        // 先找到监听的节点容器
        const targets: Element[] = [];
        if (node.matches && node.matches(listenSelector)) {
            targets.push(node);
        }
        if (node.querySelectorAll) {
            targets.push(...Array.from(node.querySelectorAll(listenSelector)));
        }
        console.log(2)

        const nodeResults: string[] = [];
        // 对每个监听容器执行 scrapeCSS
        targets.forEach(target => {
            console.log(3)

            const res = scrapeCSS(targetCssSelector, attributeName, target);
            if (res.success && res.data) {
                nodeResults.push(...res.data);
            }
        });
        console.log(nodeResults)

        return nodeResults;
    };

    // 1. 首次全量扫描已有的 listenSelector 节点
    const initialData: string[] = [];
    const existingNodes = document.querySelectorAll(listenSelector);
    existingNodes.forEach(node => {
        const res = scrapeCSS(targetCssSelector, attributeName, node);
        if (res.success && res.data) {
            initialData.push(...res.data);
        }
    });

    // 2. 建立 MutationObserver 监听后续动态追加的节点
    const observer = new MutationObserver((mutationsList) => {
        const newData: string[] = [];

        for (const mutation of mutationsList) {
            if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
                mutation.addedNodes.forEach((node) => {
                    if (node.nodeType !== Node.ELEMENT_NODE) return;
                    newData.push(...extractFromNode(node as Element));
                });
            }
        }
        console.log(newData);
        if (newData.length > 0) {
            window.postMessage({
                source: 'MY_SCRAPER_SNIPPET',
                type: 'SCRAPE_RESULT',
                payload: {
                    success: true,
                    data: newData
                }
            }, '*');
        }
    });

    observer.observe(container, {
        childList: true,
        subtree: true,
    });

    return {success: true, data: Array.from(new Set(initialData))};
}