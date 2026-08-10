<template>
  <div class="side-panel">
    <h3>QF 图片采集器</h3>

    <div class="form-item">
      <label for="xpath-input">css 选择器</label>
      <input
          id="selector-input"
          v-model="selector"
          type="text"
          placeholder="css选择器"
      />
      <label for="xpath-input">选择属性</label>
      <input
          id="selector-input"
          v-model="selectorAttribute"
          type="text"
          placeholder="选择属性 默认 src"
      />
      <label for="namespace-input">监听节点:</label>
      <input
          id="listen-node-input"
          v-model="listenNode"
          type="text"
          placeholder="监听新增节点"
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
          预览 IMG 标签图片
        </label>
        <label>
          <input v-model="isFileRename" type="checkbox"/>
          文件重命名
        </label>
      </div>


      <div class="actions">
        <button @click="sendCommandToPage" :disabled="isDisableButtonStart" class="btn-primary">开始遍历</button>
        <button
            @click="handleExportData"
            :disabled="imageStore.size === 0"
            class="btn-info"
        >
          导出数据 ({{ imageStore.size }})
        </button>
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
  </div>
</template>

<script setup lang="ts">
import {ref, onMounted, watch, onUnmounted} from 'vue';
import {
  saveHistoryToDB,
  getHistoryFromDB,
  getEffectiveNamespace,
  saveDataToLocal,
  runWithConcurrencyLimit
} from './ts/app.ts'

// 响应式状态
const selector = ref('img');
const selectorAttribute = ref('src');
const listenNode = ref('');
const isImgMode = ref(true);
const isDisableButtonStart = ref(false);
const isFileRename = ref(false);
const historyImageStore = ref<Set<string>>(new Set()); // 已下载的历史 URL 集合
const imageStore = ref<Set<string>>(new Set());        // 待下载的 URL 集合
const imageList = ref<string[]>([]);
const errorMsg = ref('');
const namespace = ref('');

const regexPattern = ref('\\?.*$');
const replaceText = ref('');


// 根据当前的命名空间加载已下载历史
const loadHistoryByNamespace = async () => {
  try {
    const targetNamespace = await getEffectiveNamespace(namespace.value);
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
    chrome.storage.local.get(['lastSelector', 'lastSelectorAttribute', 'lastListenNode', 'lastNamespace', 'lastRegexPattern', "lastReplaceText"], (result: {
      [key: string]: any
    }) => {
      if (result.lastSelector) {
        selector.value = result.lastSelector;
      }
      if (result.lastSelectorAttribute) {
        selectorAttribute.value = result.lastSelectorAttribute;
      }
      if (result.lastListenNode) {
        listenNode.value = result.lastListenNode;
      }
      if (result.lastNamespace) {
        namespace.value = result.lastNamespace;
      }
      if (result.lastRegexPattern) {
        regexPattern.value = result.lastRegexPattern;
      }
      if (result.lastReplaceText) {
        replaceText.value = result.lastReplaceText;
      }
    });
  }
  // 页面打开时，读取一次历史记录
  await loadHistoryByNamespace();
});

watch(namespace, () => {
  loadHistoryByNamespace();
});


// 侧边栏发送命令的函数
const sendCommandToPage = async () => {

  await saveDataToLocal('lastSelector', selector.value);
  await saveDataToLocal('lastSelectorAttribute', selectorAttribute.value);
  await saveDataToLocal('lastListenNode', listenNode.value);
  await saveDataToLocal('lastNamespace', namespace.value);
  await saveDataToLocal('lastRegexPattern', regexPattern.value);
  await saveDataToLocal('lastReplaceText', replaceText.value);

  try {
    // 1. 获取当前活跃的标签页 (Tab)
    const [tab] = await chrome.tabs.query({active: true, currentWindow: true});
    if (!tab?.id) {
      console.warn('未找到活跃的标签页');
      return;
    }

    let command: string = "";
    if (listenNode.value && listenNode.value.trim() !== '') {
      console.log("执行 initImageObserver")
      isDisableButtonStart.value = true
      command = "initImageObserver"
    } else {
      console.log("执行 scrapeCSS")
      command = "scrapeCSS"

    }


    // 2. 向该标签页的 content.js 发送指令
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
          // 接收 content.js 执行完后返回的数据
          if (chrome.runtime.lastError) {
            console.error('发送失败，该网页可能没有注入 content.js:', chrome.runtime.lastError.message);
          } else {
            console.log(response);
            if (response?.success) {
              let finalData = response.data || [];
              processAndStoreImages(finalData)
            } else {
              errorMsg.value = response?.error || '未知解析错误';
            }
          }
        }
    );
  } catch (error) {
    console.error('通信异常:', error);
  }
};


// 2. 批量下载图片
const handleDownloadAll = async () => {
  const images = [...imageStore.value];
  if (images.length === 0) return;

  const activeNamespace = await getEffectiveNamespace(namespace.value);

  // 1. 将所有图片转化为“待执行的下载任务”数组
  const tasks = images.map((url, index) => {
    return async () => {
      // 检查历史记录
      if (historyImageStore.value.has(url)) {
        console.warn(`[拦截] URL 已在下载历史中，跳过执行: ${url}`);
        imageStore.value.delete(url);
        return;
      }

      // 文件名解析逻辑
      const cleanUrl = url.split('?')[0].split('#')[0];
      const rawLastSegment = cleanUrl.split('/').pop() || '';
      const extMatch = rawLastSegment.match(/\.([a-zA-Z0-9]+)$/);
      const ext = extMatch ? extMatch[1] : 'jpg';

      let finalFilename = '';
      if (isFileRename.value) {
        finalFilename = `img_${index + 1}.${ext}`;
      } else {
        const hasValidExt = rawLastSegment.includes('.') && rawLastSegment.length <= 20;
        finalFilename = hasValidExt ? rawLastSegment : `img_${index + 1}.${ext}`;
      }

      const filename = `${activeNamespace}/` + finalFilename;

      // 返回 Promise 以便并发控制器捕获状态
      return new Promise<void>((resolve) => {
        chrome.downloads.search({filename, exists: true}, (results) => {
          if (chrome.runtime.lastError) {
            resolve();
            return;
          }

          if (results && results.length > 0) {
            console.warn(`本地文件已存在，跳过: ${filename}`);
            saveHistoryToDB(activeNamespace, url);
            historyImageStore.value.add(url);
            imageStore.value.delete(url);
            resolve();
            return;
          }

          // 发起 Chrome 下载
          chrome.downloads.download({
            url: url,
            filename: filename,
            conflictAction: 'uniquify',
            saveAs: false
          }, async () => {
            if (chrome.runtime.lastError) {
              console.error(`下载失败: ${chrome.runtime.lastError.message}`);
            } else {
              historyImageStore.value.add(url);
              imageStore.value.delete(url);
              try {
                await saveHistoryToDB(activeNamespace, url);
              } catch (dbErr) {
                console.error('写入 IndexedDB 失败:', dbErr);
              }
            }
            resolve(); // 🚀 下载结束（无论成败），释放并发窗口
          });
        });
      });
    };
  });

  // 2. 🚀 启动并发控制引擎：最多同时下载 3 个，每开启新下载间隔 150ms
  // 几百张图的情况下，这个参数既能保证极高的稳定性，又能成倍提升下载速度
  await runWithConcurrencyLimit(tasks, 3, 150);

  console.log('🎉 所有大批量下载任务处理完毕！');
};

// 3. 仅导出 imageStore 里的链接到 CSV
const handleExportData = () => {
  const images = [...imageStore.value];
  if (images.length === 0) return;

  // 1. 构造 CSV 内容（\uFEFF 是 BOM 头，防止 Excel 打开时链接包含的特殊字符乱码）
  let csvContent = '\uFEFF图片链接\n';

  // 2. 将每个 URL 单独作为一行放入 CSV，并用双引号包裹防止参数中有逗号导致错格
  images.forEach((url) => {
    const safeUrl = `"${url.replace(/"/g, '""')}"`;
    csvContent += `${safeUrl}\n`;
  });

  // 3. 创建 Blob 并通过临时 a 标签触发浏览器下载
  try {
    const blob = new Blob([csvContent], {type: 'text/csv;charset=utf-8;'});
    const blobUrl = URL.createObjectURL(blob);

    const link = document.createElement('a');
    link.href = blobUrl;
    link.setAttribute('download', `image_urls_${Date.now()}.csv`); // 导出的文件名

    document.body.appendChild(link);
    link.click();

    // 释放内存与节点
    document.body.removeChild(link);
    URL.revokeObjectURL(blobUrl);
  } catch (err) {
    console.error('导出 CSV 失败:', err);
    errorMsg.value = '导出 CSV 失败';
  }
};

const handleImgError = (event: Event) => {
  const target = event.target as HTMLImageElement;
  target.style.display = 'none';
};

// 监听来自 Content Script 转发过来的消息
const handleMessage = (message: any, _sender: chrome.runtime.MessageSender, sendResponse: (response?: any) => void) => {
  if (message.action === 'FROM_PAGE_SCRAPE_RESULT') {
    const {success, data, error} = message.payload;

    if (success && data) {
      processAndStoreImages(data)
    } else {
      errorMsg.value = error || '抓取失败';
    }

    // 简单响应 Content Script
    sendResponse({status: 'ok'});
  }
};

/**
 * 清洗图片 URL 数据并更新相关状态与存储
 * @param rawUrls 从页面获取到的原始 URL 数组
 * @returns boolean 表示处理过程是否成功
 */
const processAndStoreImages = (rawUrls: string[]): boolean => {
  let finalData = [...rawUrls];

  // 1. 如果正则规则不为空，进行正则替换清洗
  if (regexPattern.value.trim() !== '') {
    try {
      const reg = new RegExp(regexPattern.value, 'g');
      finalData = finalData.map((url: string) => url.replace(reg, replaceText.value || ''));
    } catch (regError: any) {
      errorMsg.value = `正则表达式错误: ${regError?.message}`;
      return false; // 处理失败，提前退出
    }
  }

  // 2. 更新视图预览数据
  imageList.value = finalData;

  // 3. 过滤掉历史记录，将新图片存入待下载集合
  finalData.forEach((item: string) => {
    if (!historyImageStore.value.has(item)) {
      imageStore.value.add(item);
    }
  });

  return true; // 处理成功
};
onMounted(() => {
  chrome.runtime.onMessage.addListener(handleMessage);
});

onUnmounted(() => {
  chrome.runtime.onMessage.removeListener(handleMessage);
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
