import CryptoJS from "crypto-js";

// ================== IndexedDB 核心功能 ==================
const DB_NAME = 'QF_ImageScraper_DB';
const STORE_NAME = 'download_history';
const DB_VERSION = 1;

const initDB = (): Promise<IDBDatabase> => {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onupgradeneeded = (event: IDBVersionChangeEvent) => {
            const db = (event.target as IDBOpenDBRequest).result;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                db.createObjectStore(STORE_NAME);
            }
        };
        request.onsuccess = (event: Event) => resolve((event.target as IDBOpenDBRequest).result);
        request.onerror = (event: Event) => reject((event.target as IDBOpenDBRequest).error);
    });
};

export const getHistoryFromDB = async (currentNamespace: string): Promise<string[]> => {
    if (!currentNamespace) return [];
    const db = await initDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(STORE_NAME, 'readonly');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.get(currentNamespace);
        request.onsuccess = () => resolve((request.result as string[]) || []);
        request.onerror = () => reject(request.error);
    });
};

// 使用 Promise 链式队列，杜绝并发下载时 saveHistoryToDB 的 Lost Update 覆盖问题
let dbQueue: Promise<void> = Promise.resolve();

export const saveHistoryToDB = (currentNamespace: string, newUrl: string): Promise<void> => {
    dbQueue = dbQueue.then(async () => {
        if (!currentNamespace || !newUrl) return;
        const db = await initDB();
        const currentHistory = await getHistoryFromDB(currentNamespace);

        if (!currentHistory.includes(newUrl)) {
            currentHistory.push(newUrl);
            return new Promise<void>((resolve, reject) => {
                const transaction = db.transaction(STORE_NAME, 'readwrite');
                const store = transaction.objectStore(STORE_NAME);
                const request = store.put(currentHistory, currentNamespace);
                request.onsuccess = () => resolve();
                request.onerror = () => reject(request.error);
            });
        }
    }).catch((err) => {
        console.error('[IndexedDB] 写入历史记录异常:', err);
    });
    return dbQueue;
};

// 清空指定命名空间的历史记录
export const clearHistoryInDB = async (currentNamespace: string): Promise<void> => {
    if (!currentNamespace) return;
    const db = await initDB();
    return new Promise<void>((resolve, reject) => {
        const transaction = db.transaction(STORE_NAME, 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.delete(currentNamespace);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
    });
};

export const getCurrentTab = async () => {
    const [tab] = await chrome.tabs.query({active: true, currentWindow: true});
    return tab;
};

// 清洗 Windows/Linux 非法字符
export const sanitizeFilename = (name: string): string => {
    return name.replace(/[\\/:*?"<>|\r\n\t]/g, '_').trim();
};

// 获取当前实际有效的 Namespace
export const getEffectiveNamespace = async (namespace: string): Promise<string> => {
    if (namespace.trim()) {
        return sanitizeFilename(namespace.trim());
    }
    const tab = await getCurrentTab();
    const currentUrl = tab?.url || window.location.href;
    return CryptoJS.MD5(currentUrl).toString();
};

export type RenameMode = 'original' | 'md5' | 'index';

/**
 * 从 URL 或 DataURL 中提取图片扩展名
 */
export const getImageExtension = (url: string): string => {
    if (!url) return 'jpg';

    // 1. Data URL 处理
    if (url.startsWith('data:image/')) {
        const mimeMatch = url.match(/^data:image\/([a-zA-Z0-9+.-]+);/);
        if (mimeMatch) {
            let ext = mimeMatch[1].toLowerCase();
            if (ext === 'jpeg') ext = 'jpg';
            if (ext.includes('+xml') || ext === 'svg+xml') ext = 'svg';
            return ext;
        }
        return 'png';
    }

    // 2. 普通 URL 的路径最后一部分
    const cleanUrl = url.split('?')[0].split('#')[0];
    const rawLastSegment = cleanUrl.split('/').pop() || '';
    const extMatch = rawLastSegment.match(/\.([a-zA-Z0-9]{2,5})$/i);
    if (extMatch) {
        let ext = extMatch[1].toLowerCase();
        if (ext === 'jpeg') ext = 'jpg';
        return ext;
    }

    // 3. 检查 query 参数中的格式参数（如 ?format=webp 或 ?wx_fmt=png）
    const paramMatch = url.match(/[?&](?:format|fmt|wx_fmt|f|type)=([a-zA-Z0-9]{2,5})/i);
    if (paramMatch) {
        let ext = paramMatch[1].toLowerCase();
        if (ext === 'jpeg') ext = 'jpg';
        return ext;
    }

    return 'jpg';
};

/**
 * 根据重命名模式生成最终下载文件名（不含命名空间目录）
 */
export const generateImageFilename = (
    url: string,
    index: number,
    mode: RenameMode = 'original'
): string => {
    const ext = getImageExtension(url);

    // 模式 2: URL MD5 Hash 值加上文件后缀 (比如 .jpg)
    if (mode === 'md5') {
        const hash = CryptoJS.MD5(url).toString();
        return `${hash}.${ext}`;
    }

    // 模式 3: 顺序编号 (比如 img_1.jpg)
    if (mode === 'index') {
        return `img_${index + 1}.${ext}`;
    }

    // 模式 1: 原文件名称（带兜底）
    if (url.startsWith('data:image/')) {
        return `img_${index + 1}.${ext}`;
    }

    const cleanUrl = url.split('?')[0].split('#')[0];
    const rawLastSegment = cleanUrl.split('/').pop() || '';
    const rawBaseName = rawLastSegment.replace(/\.[a-zA-Z0-9]+$/, '');

    let decodedBaseName = rawBaseName;
    try {
        decodedBaseName = decodeURIComponent(rawBaseName);
    } catch {
        decodedBaseName = rawBaseName;
    }

    const safeName = sanitizeFilename(decodedBaseName);
    return `${safeName || `img_${index + 1}`}.${ext}`;
};


export async function saveDataToLocal(key: string, data: any) {
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
        // 使用 JSON 序列化脱去 Vue 3 Proxy 包装，防止数组被 Chrome 存储序列化为普通 Object
        const plainData = data !== undefined ? JSON.parse(JSON.stringify(data)) : data;
        await chrome.storage.local.set({[key]: plainData});
    }
}


// 辅助函数：延迟
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * 核心：控制并发数量的执行器
 * @param tasks 任务函数数组（每个函数返回一个 Promise）
 * @param limit 最大并发数（推荐 3 ~ 5）
 * @param delayBetweenTasks 启动间隔
 * @param onProgress 进度回调 (已完成数, 总数)
 */
export const runWithConcurrencyLimit = async (
    tasks: (() => Promise<void>)[],
    limit: number,
    delayBetweenTasks: number = 100,
    onProgress?: (completed: number, total: number) => void
) => {
    const executing: Promise<void>[] = [];
    let completedCount = 0;
    const totalCount = tasks.length;

    for (const task of tasks) {
        // 启动任务并捕获异常，防止单任务失败阻断全部下载
        const p = Promise.resolve().then(() => task()).catch((err) => {
            console.error('[Concurrency Task Error]:', err);
        }).finally(() => {
            completedCount++;
            if (onProgress) {
                onProgress(completedCount, totalCount);
            }
            const index = executing.indexOf(p);
            if (index > -1) executing.splice(index, 1);
        });

        executing.push(p);

        // 如果达到了最大并发数，等待其中任意一个完成
        if (executing.length >= limit) {
            await Promise.race(executing);
        }

        if (delayBetweenTasks > 0) {
            await sleep(delayBetweenTasks);
        }
    }

    // 等待最后一批任务全部完成
    await Promise.all(executing);
};


