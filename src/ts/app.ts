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


