<template>
  <div class="side-panel">
    <h3>QF 图片采集器</h3>

    <div class="form-item">
      <label for="xpath-input">XPath 规则:</label>
      <input
          id="xpath-input"
          v-model="xpath"
          type="text"
          placeholder="例如: //img 或 //div[@class='thumb']/img"
      />
    </div>

    <div class="form-item">
      <label for="namespace-input">命名空间:</label>
      <input
          id="namespace-input"
          v-model="namespace"
          @change="loadHistoryByNamespace"
          type="text"
          placeholder="用于下载图片的时候加上前缀，如果没用默认以当前url md5值"
      />
    </div>

    <div class="form-item">
      <div class="regex-tools">
        <div class="input-group">
          <label>正则替换 (如: _\d+x\d+):</label>
          <input
              v-model="regexPattern"
              type="text"
              placeholder="输入正则表达式，留空不替换"
              class="my-input"
          />
        </div>

        <div class="input-group">
          <label>替换内容 (如: 空白或大图后缀):</label>
          <input
              v-model="replaceText"
              type="text"
              placeholder="要替换成的内容"
              class="my-input"
          />
        </div>
      </div>
    </div>

    <div class="form-item checkbox-item">
      <label>
        <input v-model="isImgMode" type="checkbox"/>
        仅提取并预览 IMG 标签图片
      </label>
    </div>

    <div class="actions">
      <button @click="startScraping" class="btn-primary">开始遍历</button>
      <button
          @click="handleDownloadAll"
          :disabled="imageStore.size === 0"
          class="btn-success"
      >
        下载全部 ({{ imageStore.size }})
      </button>
    </div>

    <p v-if="errorMsg" class="error-text">{{ errorMsg }}</p>

    <hr class="divider"/>
    <h2>当前规则匹配数量: {{ imageList.length }}</h2>
    <div v-if="isImgMode" class="preview-grid">
      <div
          v-for="(url, index) in imageList"
          :key="index"
          class="img-card"
      >
        <img
            :src="url"
            alt="preview"
            :style="{ opacity: historyImageStore.has(url) ? 0.4 : 1 }"
            @error="handleImgError"
        />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import {ref, onMounted, watch} from 'vue';
import {scrapeXPath} from './ts/xpathScraper';
import CryptoJS from 'crypto-js';

// 响应式状态
const xpath = ref('//img');
const isImgMode = ref(true);
const historyImageStore = ref<Set<string>>(new Set()); // 已下载的历史 URL 集合
const imageStore = ref<Set<string>>(new Set());        // 待下载的 URL 集合
const imageList = ref<string[]>([]);
const errorMsg = ref('');
const namespace = ref('');

const regexPattern = ref('\\?.*$');
const replaceText = ref('');

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

// ✨ 修复点 1：将返回值改为具体的 Promise<string[]>，避免出现 unknown 类型错误
const getHistoryFromDB = async (currentNamespace: string): Promise<string[]> => {
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

const saveHistoryToDB = async (currentNamespace: string, newUrl: string) => {
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

// ================== 业务逻辑方法 ==================

const getCurrentTab = async () => {
  const [tab] = await chrome.tabs.query({active: true, currentWindow: true});
  return tab;
};

// 获取当前实际有效的 Namespace
const getEffectiveNamespace = async (): Promise<string> => {
  if (namespace.value.trim()) {
    return namespace.value.trim();
  }
  const tab = await getCurrentTab();
  const currentUrl = tab?.url || window.location.href;
  return CryptoJS.MD5(currentUrl).toString();
};

// 根据当前的命名空间加载已下载历史
const loadHistoryByNamespace = async () => {
  try {
    const targetNamespace = await getEffectiveNamespace();
    // historyArray 现在被正确识别为 string[]
    const historyArray = await getHistoryFromDB(targetNamespace);
    historyImageStore.value = new Set(historyArray);
    console.log(`[IndexedDB] 成功载入命名空间 [${targetNamespace}] 的历史记录，共 ${historyArray.length} 条`);

    historyArray.forEach((url: string) => {
      if (imageStore.value.has(url)) {
        imageStore.value.delete(url);
      }
    });
  } catch (err) {
    console.error('读取 IndexedDB 历史记录失败:', err);
  }
};

onMounted(async () => {
  if (typeof chrome !== 'undefined' && chrome.storage?.local) {
    // ✨ 修复点 2：为传入的 result 声明具体类型，或者依赖 @types/chrome 推导
    chrome.storage.local.get(['lastXpath'], (result: { [key: string]: any }) => {
      if (result.lastXpath) {
        xpath.value = result.lastXpath;
      }
    });
  }
  // 页面打开时，读取一次历史记录
  await loadHistoryByNamespace();
});

watch(namespace, () => {
  loadHistoryByNamespace();
});

async function saveDataToLocal(key: string, data: any) {
  if (typeof chrome !== 'undefined' && chrome.storage?.local) {
    await chrome.storage.local.set({[key]: data});
  }
}

// 1. 执行 XPath 扫描
const startScraping = async () => {
  await saveDataToLocal('lastXpath', xpath.value);

  const tab = await getCurrentTab();
  if (!tab?.id) return;

  errorMsg.value = '';

  try {
    const results = await chrome.scripting.executeScript({
      target: {tabId: tab.id},
      func: scrapeXPath,
      args: [xpath.value, isImgMode.value],
    });

    const executionResult = results?.[0]?.result as any; // 转换结果断言
    if (executionResult?.success) {
      let finalData = executionResult.data || [];

      if (regexPattern.value.trim() !== '') {
        try {
          const reg = new RegExp(regexPattern.value, 'g');
          finalData = finalData.map((url: string) => url.replace(reg, replaceText.value || ''));
        } catch (regError: any) {
          errorMsg.value = `正则表达式错误: ${regError?.message}`;
          return;
        }
      }

      imageList.value = finalData;

      finalData.forEach((item: string) => {
        if (!historyImageStore.value.has(item)) {
          imageStore.value.add(item);
        }
      });

    } else {
      errorMsg.value = executionResult?.error || '未知解析错误';
    }
  } catch (err: any) {
    errorMsg.value = `脚本注入失败或执行挂掉: ${err?.message}`;
  }
};

// 2. 批量下载图片
const handleDownloadAll = async () => {
  const images = [...imageStore.value];
  if (images.length === 0) return;

  const activeNamespace = await getEffectiveNamespace();

  images.forEach((url, index) => {
    if (historyImageStore.value.has(url)) {
      console.warn(`[拦截] URL 已在下载历史中，跳过执行: ${url}`);
      imageStore.value.delete(url);
      return;
    }

    const cleanUrl = url.split('?')[0].split('#')[0];
    let originalFilename = cleanUrl.split('/').pop();

    if (!originalFilename || !originalFilename.includes('.')) {
      const ext = url.split('.').pop()?.split('?')[0] || 'jpg';
      originalFilename = `img_${index + 1}.${ext}`;
    }

    const filename = `${activeNamespace}/` + originalFilename;

    chrome.downloads.search({
      filename: filename,
      exists: true
    }, (results: chrome.downloads.DownloadItem[]) => { // ✨ 修复点 3：补全显式类型定义
      if (chrome.runtime.lastError) return;

      if (results && results.length > 0) {
        console.warn(`本地文件已存在，跳过下载并同步更新历史状态: ${filename}`);
        saveHistoryToDB(activeNamespace, url);
        historyImageStore.value.add(url);
        imageStore.value.delete(url);
        return;
      }

      chrome.downloads.download({
        url: url,
        filename: filename,
        conflictAction: 'uniquify',
        saveAs: false
      }, async () => { // ✨ 修复点 4：移除了未使用的 downloadId 参数
        if (chrome.runtime.lastError) {
          console.error(`下载失败: ${chrome.runtime.lastError.message}`);
        } else {
          historyImageStore.value.add(url);
          imageStore.value.delete(url);

          try {
            await saveHistoryToDB(activeNamespace, url);
            console.log(`[IndexedDB] 成功保存下载记录: ${url}`);
          } catch (dbErr) {
            console.error('写入 IndexedDB 失败:', dbErr);
          }
        }
      });
    });
  });
};

const handleImgError = (event: Event) => {
  const target = event.target as HTMLImageElement;
  target.style.display = 'none';
};
</script>

<style scoped>
.side-panel {
  padding: 16px;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  color: #333;
}

h3 {
  margin-top: 0;
  color: #2c3e50;
}

.form-item {
  margin-bottom: 12px;
}

.form-item label {
  display: block;
  margin-bottom: 4px;
  font-size: 14px;
  font-weight: bold;
}

input[type="text"] {
  width: 100%;
  padding: 8px;
  border: 1px solid #ddd;
  border-radius: 4px;
  box-sizing: border-box;
}

.checkbox-item label {
  display: flex;
  align-items: center;
  gap: 6px;
  font-weight: normal;
  cursor: pointer;
}

.actions {
  display: flex;
  gap: 10px;
  margin-top: 16px;
}

button {
  flex: 1;
  padding: 8px 12px;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-weight: bold;
  transition: background 0.2s;
}

button:disabled {
  background-color: #e0e0e0;
  color: #a0a0a0;
  cursor: not-allowed;
}

.btn-primary {
  background-color: #3498db;
  color: white;
}

.btn-primary:hover:not(:disabled) {
  background-color: #2980b9;
}

.btn-success {
  background-color: #2ecc71;
  color: white;
}

.btn-success:hover:not(:disabled) {
  background-color: #27ae60;
}

.error-text {
  color: #e74c3c;
  font-size: 13px;
  margin-top: 8px;
}

.divider {
  margin: 16px 0;
  border: none;
  border-top: 1px solid #eee;
}

.preview-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(80px, 1fr));
  gap: 8px;
  max-height: 60vh;
  overflow-y: auto;
}

.img-card {
  border: 1px solid #f0f0f0;
  border-radius: 4px;
  padding: 4px;
  background: #fafafa;
  display: flex;
  align-items: center;
  justify-content: center;
  height: 80px;
}

.img-card img {
  max-width: 100%;
  max-height: 100%;
  object-fit: cover;
  border-radius: 2px;
  transition: opacity 0.3s;
}
</style>
