function search(imageIndex = 0) { // 设置默认值为 0，防止不传参报错
    // const unhandledNodes = document.querySelectorAll('noframes[data-apiary="patch"]:not([data-processed="true"])');
    const unhandledNodes = document.querySelectorAll('noframes[data-apiary="patch"]');
    if (unhandledNodes.length === 0) return [];

    const images = [];

    unhandledNodes.forEach(noframes => {
        // noframes.setAttribute('data-processed', 'true');

        try {
            const rawText = noframes.textContent.trim();
            if (!rawText) return;

            const data = JSON.parse(rawText);
            let foundPictures = null;

            // 递归查找 JSON 里的 pictures 属性
            const extractPictures = (obj) => {
                if (!obj || typeof obj !== 'object' || foundPictures) return;

                if (Array.isArray(obj.pictures) && obj.pictures.length > 0) {
                    foundPictures = obj.pictures;
                    return;
                }

                Object.values(obj).forEach(val => extractPictures(val));
            };

            extractPictures(data);

            // 确保找到了有效的图片数组，且对应 index 的图片存在
            if (foundPictures && foundPictures[imageIndex] !== undefined) {
                images.push(foundPictures[imageIndex].picture.baseUrl + "orig");
            }
        } catch (e) {
            // 忽略 JSON 解析失败的节点
        }
    });

    return images;
}

// 调用 search（若不传参默认取第 0 张）
const images = search(0);

const result = images.length === 0
    ? {success: false, error: "No images found."}
    : {success: true, data: images};

// 通过 postMessage 发送给 Content Script
window.postMessage({
    source: 'MY_SCRAPER_SNIPPET',
    type: 'SCRAPE_RESULT',
    payload: result
}, '*');