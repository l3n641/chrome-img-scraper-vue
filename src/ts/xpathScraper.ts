export function scrapeXPath(xpathExpression: string, isImgMode: boolean) {
    const results: string[] = [];
    try {
        const evaluator = new XPathEvaluator();
        const expression = evaluator.createExpression(xpathExpression);
        const result = expression.evaluate(document, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);

        for (let i = 0; i < result.snapshotLength; i++) {
            const node = result.snapshotItem(i);
            if (!node) continue;

            if (isImgMode) {
                if (node.nodeName.toLowerCase() === 'img') {
                    const src = (node as HTMLImageElement).src;
                    if (src) results.push(src);
                } else {
                    const imgs = (node as HTMLElement).querySelectorAll('img');
                    imgs.forEach(img => results.push(img.src));
                }
            } else {
                results.push(node.textContent || '');
            }
        }
        return { success: true, data: results };
    } catch (error: any) {
        return { success: false, error: error.message };
    }
}