<template>
  <div class="side-panel">
    <h3>QF 图片采集器</h3>

    <div class="form-item">
      <label for="selector-input">CSS 选择器</label>
      <input
          id="selector-input"
          v-model="selector"
          type="text"
          placeholder="例如: img 或 .item-pic img"
      />
    </div>

    <div class="form-item">
      <label for="selector-attribute-input">选择属性</label>
      <input
          id="selector-attribute-input"
          v-model="selectorAttribute"
          type="text"
          placeholder="选择属性，默认 src（如 data-src, data-original）"
      />
    </div>

    <div class="form-item">
      <label for="listen-node-input">监听节点容器 (可选):</label>
      <input
          id="listen-node-input"
          v-model="listenNode"
          type="text"
          placeholder="留空单次抓取；填容器选择器则监听动态加载"
      />
    </div>

    <div class="form-item">
      <label for="namespace-input">命名空间 (子文件夹名):</label>
      <div class="namespace-row">
        <input
            id="namespace-input"
            v-model="namespace"
            @change="loadHistoryByNamespace"
            type="text"
            placeholder="留空默认当前网址 MD5"
        />
        <button
            class="btn-text"
            @click="handleClearHistory"
            :title="'清空此命名空间的已下载记录 (' + historyImageStore.size + ')'"
        >
          清空历史
        </button>
      </div>
    </div>

    <div class="form-item">
      <div class="regex-tools">
        <div class="input-group">
          <label>正则替换 (如: _\d+x\d+ 或 \?.*$):</label>
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
        预览图片
      </label>
      <label>
        <input v-model="isFileRename" type="checkbox"/>
        顺序重命名 (img_1.jpg)
      </label>
    </div>

    <div class="actions">
      <button
          v-if="!isObserving"
          @click="sendCommandToPage"
          :disabled="downloadStatus.isDownloading"
          class="btn-primary"
      >
        开始遍历
      </button>
      <button
          v-else
          @click="stopObserverInPage"
          class="btn-warning"
      >
        停止监听
      </button>

      <button
          @click="handleExportData"
          :disabled="downloadStatus.isDownloading || imageStore.size === 0"
          class="btn-info"
      >
        导出 ({{ imageStore.size }})
      </button>
      <button
          @click="handleDownloadAll"
          :disabled="downloadStatus.isDownloading || imageStore.size === 0"
          class="btn-success"
      >
        {{ downloadStatus.isDownloading ? `下载中 (${downloadStatus.current}/${downloadStatus.total})` : `下载 (${imageStore.size})` }}
      </button>
    </div>

    <!-- 下载进度条 -->
    <div v-if="downloadStatus.isDownloading" class="progress-box">
      <div class="progress-bar">
        <div
            class="progress-fill"
            :style="{ width: ((downloadStatus.current / (downloadStatus.total || 1)) * 100) + '%' }"
        ></div>
      </div>
      <span class="progress-text">
        正在下载: {{ downloadStatus.current }} / {{ downloadStatus.total }}
        (成功: {{ downloadStatus.success }}, 失败: {{ downloadStatus.failed }})
      </span>
    </div>

    <p v-if="errorMsg" class="error-text">{{ errorMsg }}</p>

    <hr class="divider"/>

    <div class="list-header">
      <h4>匹配数量: {{ imageList.length }} <span class="sub-tip">(待下载: {{ imageStore.size }}, 已下载: {{ historyImageStore.size }})</span></h4>
      <button v-if="imageList.length > 0" @click="handleClearList" class="btn-text">清空列表</button>
    </div>

    <div v-if="isImgMode" class="preview-grid">
      <div
          v-for="(url, index) in imageList"
          :key="index"
          class="img-card"
          :title="url"
      >
        <img
            :src="url"
            alt="preview"
            loading="lazy"
            :style="{ opacity: historyImageStore.has(url) ? 0.35 : 1 }"
            @error="handleImgError"
        />
        <span v-if="historyImageStore.has(url)" class="badge-downloaded">已下</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import {ref, onMounted, watch, onUnmounted} from 'vue';
import {
  saveHistoryToDB,
  getHistoryFromDB,
  clearHistoryInDB,
  getEffectiveNamespace,
  sanitizeFilename,
  saveDataToLocal,
  runWithConcurrencyLimit
} from './ts/app.ts';

// 响应式状态
const selector = ref('img');
const selectorAttribute = ref('src');
const listenNode = ref('');
const isImgMode = ref(true);
const isObserving = ref(false);
const isFileRename = ref(false);
const historyImageStore = ref<Set<string>>(new Set()); // 已下载的历史 URL 集合
const imageStore = ref<Set<string>>(new Set());        // 待下载的 URL 集合
const imageList = ref<string[]>([]);
const errorMsg = ref('');
const namespace = ref('');

const regexPattern = ref('\\?.*$');
const replaceText = ref('');

// 下载状态
const downloadStatus = ref({
  isDownloading: false,
  current: 0,
  total: 0,
  success: 0,
  failed: 0,
});

// 根据命名空间加载已下载历史
const loadHistoryByNamespace = async () => {
  try {
    const targetNamespace = await getEffectiveNamespace(namespace.value);
    const historyArray = await getHistoryFromDB(targetNamespace);
    historyImageStore.value = new Set(historyArray);
    console.log(`[IndexedDB] 成功载入 [${targetNamespace}] 历史记录，共 ${historyArray.length} 条`);

    // 剔除已下载的
    historyArray.forEach((url: string) => {
      imageStore.value.delete(url);
    });
    imageStore.value = new Set(imageStore.value);
  } catch (err) {
    console.error('读取 IndexedDB 历史记录失败:', err);
  }
};

// 清空当前命名空间的已下载记录
const handleClearHistory = async () => {
  try {
    const targetNamespace = await getEffectiveNamespace(namespace.value);
    await clearHistoryInDB(targetNamespace);
    historyImageStore.value.clear();
    historyImageStore.value = new Set();
    // 重新把当前列表已匹配的图片加回待下载集合
    imageList.value.forEach((url) => {
      imageStore.value.add(url);
    });
    imageStore.value = new Set(imageStore.value);
    errorMsg.value = '';
    console.log(`已清空命名空间 [${targetNamespace}] 的历史记录`);
  } catch (err) {
    console.error('清空历史记录失败:', err);
  }
};

const handleClearList = () => {
  imageList.value = [];
  imageStore.value.clear();
  imageStore.value = new Set();
};

onMounted(async () => {
  if (typeof chrome !== 'undefined' && chrome.storage?.local) {
    chrome.storage.local.get(
        ['lastSelector', 'lastSelectorAttribute', 'lastListenNode', 'lastNamespace', 'lastRegexPattern', 'lastReplaceText'],
        (result: {[key: string]: any}) => {
          if (result.lastSelector) selector.value = result.lastSelector;
          if (result.lastSelectorAttribute) selectorAttribute.value = result.lastSelectorAttribute;
          if (result.lastListenNode) listenNode.value = result.lastListenNode;
          if (result.lastNamespace) namespace.value = result.lastNamespace;
          if (result.lastRegexPattern) regexPattern.value = result.lastRegexPattern;
          if (result.lastReplaceText) replaceText.value = result.lastReplaceText;
        }
    );
  }
  await loadHistoryByNamespace();
});

watch(namespace, () => {
  loadHistoryByNamespace();
});

// 向页面发送抓取指令
const sendCommandToPage = async () => {
  errorMsg.value = '';

  await saveDataToLocal('lastSelector', selector.value);
  await saveDataToLocal('lastSelectorAttribute', selectorAttribute.value);
  await saveDataToLocal('lastListenNode', listenNode.value);
  await saveDataToLocal('lastNamespace', namespace.value);
  await saveDataToLocal('lastRegexPattern', regexPattern.value);
  await saveDataToLocal('lastReplaceText', replaceText.value);

  try {
    const [tab] = await chrome.tabs.query({active: true, currentWindow: true});
    if (!tab?.id) {
      errorMsg.value = '未找到当前网页标签页';
      return;
    }

    let command = "scrapeCSS";
    if (listenNode.value && listenNode.value.trim() !== '') {
      command = "initImageObserver";
      isObserving.value = true;
    } else {
      isObserving.value = false;
    }

    chrome.tabs.sendMessage(
        tab.id,
        {
          action: 'START_SCRAPE_FROM_SIDEBAR',
          payload: {
            command,
            args: {
              selector: selector.value,
              selectorAttribute: selectorAttribute.value,
              listenNode: listenNode.value,
            }
          }
        },
        (response) => {
          if (chrome.runtime.lastError) {
            errorMsg.value = '无法与当前网页通信，请确保在普通网页并刷新重试';
            isObserving.value = false;
            return;
          }

          if (response?.success) {
            const finalData = response.data || [];
            processAndStoreImages(finalData, false);
          } else {
            errorMsg.value = response?.error || '网页解析失败';
            isObserving.value = false;
          }
        }
    );
  } catch (error: any) {
    errorMsg.value = `通信异常: ${error?.message || error}`;
    isObserving.value = false;
  }
};

// 停止页面的监听
const stopObserverInPage = async () => {
  try {
    const [tab] = await chrome.tabs.query({active: true, currentWindow: true});
    if (tab?.id) {
      chrome.tabs.sendMessage(tab.id, {
        action: 'START_SCRAPE_FROM_SIDEBAR',
        payload: { command: 'stopObserver' }
      });
    }
  } catch (err) {
    console.warn('停止监听消息发送失败:', err);
  } finally {
    isObserving.value = false;
  }
};

// 批量下载图片
const handleDownloadAll = async () => {
  const images = [...imageStore.value];
  if (images.length === 0 || downloadStatus.value.isDownloading) return;

  const rawNamespace = await getEffectiveNamespace(namespace.value);
  const activeNamespace = sanitizeFilename(rawNamespace) || 'downloads';

  downloadStatus.value = {
    isDownloading: true,
    current: 0,
    total: images.length,
    success: 0,
    failed: 0,
  };

  const tasks = images.map((url, index) => {
    return async () => {
      if (historyImageStore.value.has(url)) {
        imageStore.value.delete(url);
        imageStore.value = new Set(imageStore.value);
        return;
      }

      // 文件名与扩展名解析
      let ext = 'jpg';
      let cleanFilename = '';

      if (url.startsWith('data:image/')) {
        const mimeMatch = url.match(/^data:image\/([a-zA-Z0-9]+);/);
        ext = mimeMatch ? mimeMatch[1].toLowerCase() : 'png';
        cleanFilename = `img_${index + 1}.${ext}`;
      } else {
        const cleanUrl = url.split('?')[0].split('#')[0];
        const rawLastSegment = cleanUrl.split('/').pop() || '';
        const extMatch = rawLastSegment.match(/\.([a-zA-Z0-9]{2,5})$/i);
        ext = extMatch ? extMatch[1].toLowerCase() : 'jpg';

        if (isFileRename.value) {
          cleanFilename = `img_${index + 1}.${ext}`;
        } else {
          const rawBaseName = rawLastSegment.replace(/\.[a-zA-Z0-9]+$/, '');
          const safeName = sanitizeFilename(decodeURIComponent(rawBaseName || 'img'));
          cleanFilename = `${safeName || `img_${index + 1}`}.${ext}`;
        }
      }

      const filename = `${activeNamespace}/${cleanFilename}`;

      return new Promise<void>((resolve) => {
        chrome.downloads.download({
          url: url,
          filename: filename,
          conflictAction: 'uniquify',
          saveAs: false
        }, async (downloadId) => {
          if (chrome.runtime.lastError || !downloadId) {
            console.error(`下载失败: ${chrome.runtime.lastError?.message || '未知错误'}`, url);
            downloadStatus.value.failed++;
          } else {
            downloadStatus.value.success++;
            historyImageStore.value.add(url);
            historyImageStore.value = new Set(historyImageStore.value);

            imageStore.value.delete(url);
            imageStore.value = new Set(imageStore.value);

            try {
              await saveHistoryToDB(activeNamespace, url);
            } catch (dbErr) {
              console.error('写入 IndexedDB 失败:', dbErr);
            }
          }
          resolve();
        });
      });
    };
  });

  try {
    await runWithConcurrencyLimit(tasks, 3, 150, (completed) => {
      downloadStatus.value.current = completed;
    });
  } finally {
    downloadStatus.value.isDownloading = false;
  }

  console.log('🎉 所有大批量下载任务处理完毕！');
};

// 导出 CSV 链接
const handleExportData = () => {
  const images = [...imageStore.value];
  const targetImages = images.length > 0 ? images : imageList.value;
  if (targetImages.length === 0) return;

  let csvContent = '\uFEFF图片链接\n';
  targetImages.forEach((url) => {
    const safeUrl = `"${url.replace(/"/g, '""')}"`;
    csvContent += `${safeUrl}\n`;
  });

  try {
    const blob = new Blob([csvContent], {type: 'text/csv;charset=utf-8;'});
    const blobUrl = URL.createObjectURL(blob);

    const link = document.createElement('a');
    link.href = blobUrl;
    link.setAttribute('download', `image_urls_${Date.now()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(blobUrl);
  } catch (err) {
    console.error('导出 CSV 失败:', err);
    errorMsg.value = '导出 CSV 失败';
  }
};

const handleImgError = (event: Event) => {
  const target = event.target as HTMLImageElement;
  target.style.opacity = '0.2';
};

// 监听来自 Content Script 转发过来的消息 (包含控制台与 Observer)
const handleMessage = (message: any, _sender: chrome.runtime.MessageSender, sendResponse: (response?: any) => void) => {
  if (message.action === 'FROM_PAGE_SCRAPE_RESULT') {
    const {success, data, error} = message.payload;

    if (success && data) {
      // 动态追加去重
      processAndStoreImages(data, true);
    } else {
      errorMsg.value = error || '抓取失败';
    }

    sendResponse({status: 'ok'});
  }
};

/**
 * 清洗图片 URL 数据并更新相关状态与存储
 * @param rawUrls 从页面获取到的原始 URL 数组
 * @param isAppend 是否为追加模式（用于动态监听或控制台多次推送）
 */
const processAndStoreImages = (rawUrls: string[], isAppend: boolean = false): boolean => {
  let finalData = rawUrls.filter(u => typeof u === 'string' && u.trim().length > 0);

  // 正则替换
  if (regexPattern.value.trim() !== '') {
    try {
      const reg = new RegExp(regexPattern.value, 'g');
      finalData = finalData.map((url: string) => url.replace(reg, replaceText.value || ''));
    } catch (regError: any) {
      errorMsg.value = `正则表达式错误: ${regError?.message}`;
      return false;
    }
  }

  // 过滤无效项
  finalData = finalData.filter(u => u && u.trim().length > 0);

  // 更新预览列表
  if (isAppend) {
    const combined = new Set([...imageList.value, ...finalData]);
    imageList.value = Array.from(combined);
  } else {
    imageList.value = Array.from(new Set(finalData));
  }

  // 存入待下载集合（排除已下载历史）
  finalData.forEach((item: string) => {
    if (!historyImageStore.value.has(item)) {
      imageStore.value.add(item);
    }
  });
  imageStore.value = new Set(imageStore.value);

  return true;
};

onMounted(() => {
  chrome.runtime.onMessage.addListener(handleMessage);
});

onUnmounted(() => {
  chrome.runtime.onMessage.removeListener(handleMessage);
  stopObserverInPage();
});
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
  border-bottom: 2px solid #3498db;
  padding-bottom: 8px;
}

.form-item {
  margin-bottom: 12px;
}

.form-item label {
  display: block;
  margin-bottom: 4px;
  font-size: 13px;
  font-weight: 600;
  color: #555;
}

input[type="text"] {
  width: 100%;
  padding: 8px 10px;
  border: 1px solid #ddd;
  border-radius: 4px;
  box-sizing: border-box;
  font-size: 13px;
}

input[type="text"]:focus {
  outline: none;
  border-color: #3498db;
}

.namespace-row {
  display: flex;
  gap: 8px;
}

.btn-text {
  background: none;
  border: none;
  color: #e74c3c;
  cursor: pointer;
  font-size: 12px;
  padding: 0 4px;
  white-space: nowrap;
}

.btn-text:hover {
  text-decoration: underline;
}

.regex-tools {
  display: flex;
  flex-direction: column;
  gap: 8px;
  background: #f9f9f9;
  padding: 8px;
  border-radius: 4px;
}

.input-group label {
  font-size: 12px;
  color: #666;
}

.checkbox-item {
  display: flex;
  gap: 16px;
}

.checkbox-item label {
  display: flex;
  align-items: center;
  gap: 6px;
  font-weight: normal;
  cursor: pointer;
  font-size: 13px;
}

.actions {
  display: flex;
  gap: 8px;
  margin-top: 14px;
}

button {
  flex: 1;
  padding: 8px 10px;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-weight: 600;
  font-size: 13px;
  transition: opacity 0.2s, background 0.2s;
}

button:disabled {
  background-color: #e0e0e0 !important;
  color: #a0a0a0 !important;
  cursor: not-allowed;
}

.btn-primary {
  background-color: #3498db;
  color: white;
}
.btn-primary:hover:not(:disabled) {
  background-color: #2980b9;
}

.btn-warning {
  background-color: #e67e22;
  color: white;
}
.btn-warning:hover:not(:disabled) {
  background-color: #d35400;
}

.btn-info {
  background-color: #34495e;
  color: white;
}
.btn-info:hover:not(:disabled) {
  background-color: #2c3e50;
}

.btn-success {
  background-color: #2ecc71;
  color: white;
}
.btn-success:hover:not(:disabled) {
  background-color: #27ae60;
}

.progress-box {
  margin-top: 10px;
}

.progress-bar {
  width: 100%;
  height: 6px;
  background-color: #eee;
  border-radius: 3px;
  overflow: hidden;
}

.progress-fill {
  height: 100%;
  background-color: #2ecc71;
  transition: width 0.2s;
}

.progress-text {
  display: block;
  font-size: 12px;
  color: #666;
  margin-top: 4px;
  text-align: right;
}

.error-text {
  color: #e74c3c;
  font-size: 12px;
  margin-top: 8px;
}

.divider {
  margin: 14px 0;
  border: none;
  border-top: 1px solid #eee;
}

.list-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}

.list-header h4 {
  margin: 0;
  font-size: 14px;
}

.sub-tip {
  font-size: 12px;
  font-weight: normal;
  color: #888;
}

.preview-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(75px, 1fr));
  gap: 6px;
  max-height: 55vh;
  overflow-y: auto;
  padding: 4px;
}

.img-card {
  position: relative;
  border: 1px solid #eee;
  border-radius: 4px;
  background: #fafafa;
  display: flex;
  align-items: center;
  justify-content: center;
  height: 75px;
  overflow: hidden;
}

.img-card img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  border-radius: 2px;
}

.badge-downloaded {
  position: absolute;
  top: 2px;
  right: 2px;
  background: rgba(0, 0, 0, 0.6);
  color: #fff;
  font-size: 10px;
  padding: 1px 3px;
  border-radius: 2px;
}
</style>
