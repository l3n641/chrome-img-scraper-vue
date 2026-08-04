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

export const saveHistoryToDB = async (currentNamespace: string, newUrl: string) => {
    if (!currentNamespace) return;
    const db = await initDB();
    const currentHistory = await getHistoryFromDB(currentNamespace);

    if (!currentHistory.includes(newUrl)) {
        currentHistory.push(newUrl);
    }

    return new Promise<void>((resolve, reject) => {
        const transaction = db.transaction(STORE_NAME, 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.put(currentHistory, currentNamespace);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
    });
};

export const getCurrentTab = async () => {
    const [tab] = await chrome.tabs.query({active: true, currentWindow: true});
    return tab;
};

// 获取当前实际有效的 Namespace
export const getEffectiveNamespace = async (namespace: string): Promise<string> => {
    if (namespace.trim()) {
        return namespace.trim();
    }
    const tab = await getCurrentTab();
    const currentUrl = tab?.url || window.location.href;
    return CryptoJS.MD5(currentUrl).toString();
};

export async function saveDataToLocal(key: string, data: any) {
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
        await chrome.storage.local.set({[key]: data});
    }
}


// 辅助函数：延迟
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * 核心：控制并发数量的执行器
 * @param tasks 任务函数数组（每个函数返回一个 Promise）
 * @param limit 最大并发数（推荐 3 ~ 5，不要超过 10）
 * @param delayBetweenTasks 每次启动新任务的微小缓冲延迟（毫秒）
 */
export const runWithConcurrencyLimit = async (
    tasks: (() => Promise<void>)[],
    limit: number,
    delayBetweenTasks: number = 100
) => {
    const executing: Promise<void>[] = [];

    for (const task of tasks) {
        // 启动任务
        const p = task();
        executing.push(p);

        // 任务完成后，从正在执行的队列中移除
        p.then(() => {
            const index = executing.indexOf(p);
            if (index > -1) executing.splice(index, 1);
        });

        // 如果达到了最大并发数，就等待其中任意一个完成
        if (executing.length >= limit || executing.length >= limit) {
            await Promise.race(executing);
        }

        // 🚀 核心关键：即使并发没满，连续启动新任务时也强制微调休，防止瞬间并发暴击
        if (delayBetweenTasks > 0) {
            await sleep(delayBetweenTasks);
        }
    }

    // 等待最后一批尾巴任务全部执行完毕
    await Promise.all(executing);
};

