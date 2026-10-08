<template>
  <div class="side-panel">
    <h3>QF 图片采集器</h3>

    <!-- 规则模板管理区 -->
    <div class="template-section">
      <div class="template-header">
        <label for="template-select">规则模板</label>
        <button
            type="button"
            class="btn-text-action"
            @click="showSaveBox = !showSaveBox"
            :title="showSaveBox ? '取消保存' : '将当前输入框内容保存为模板'"
        >
          {{ showSaveBox ? '✕ 取消' : '＋ 存为模板' }}
        </button>
      </div>

      <div class="template-row">
        <select
            id="template-select"
            v-model="selectedTemplateId"
            @change="applyTemplate"
            class="template-select"
        >
          <option value="">-- 选择已有模板 --</option>
          <option v-for="tpl in templateList" :key="tpl.id" :value="tpl.id">
            {{ tpl.name }}
          </option>
        </select>
        <button
            v-if="selectedTemplateId"
            type="button"
            class="btn-delete-template"
            @click="deleteTemplate(selectedTemplateId)"
            title="删除选中的模板"
        >
          删除
        </button>
      </div>

      <!-- 另存为新模板输入框 -->
      <div v-if="showSaveBox" class="save-template-box">
        <input
            v-model="newTemplateName"
            type="text"
            placeholder="输入模板名称，如: 某站瀑布流"
            @keyup.enter="saveCurrentAsTemplate"
            class="template-input"
        />
        <button type="button" @click="saveCurrentAsTemplate" class="btn-confirm-save">
          保存
        </button>
      </div>
    </div>

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

    <div class="form-item">
      <label for="rename-mode-select">下载重命名方式</label>
      <select
          id="rename-mode-select"
          v-model="renameMode"
          class="custom-select"
      >
        <option value="original">1 - 原文件名称</option>
        <option value="md5">2 - URL MD5 Hash 值加上文件后缀 (比如 .jpg)</option>
        <option value="index">3 - 顺序编号 (img_1.jpg)</option>
      </select>
    </div>

    <div class="form-item checkbox-item">
      <label>
        <input v-model="isImgMode" type="checkbox"/>
        预览图片
      </label>
      <label title="勾选后为已遍历元素添加类标记(qf-scraped-item)，下次遍历时跳过已标记元素，防止多次匹配导致卡顿">
        <input v-model="markScraped" type="checkbox"/>
        跳过已遍历元素 (防卡顿)
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
  runWithConcurrencyLimit,
  generateImageFilename,
  type RenameMode
} from './ts/app.ts';

// 模板数据结构定义
export interface ScraperTemplate {
  id: string;
  name: string;
  selector: string;
  selectorAttribute: string;
  listenNode: string;
  namespace: string;
  regexPattern: string;
  replaceText: string;
  isImgMode: boolean;
  isFileRename?: boolean;
  renameMode?: RenameMode;
  markScraped?: boolean;
}

// 模板管理状态
const templateList = ref<ScraperTemplate[]>([]);
const selectedTemplateId = ref<string>('');
const showSaveBox = ref(false);
const newTemplateName = ref('');

// 响应式状态
const selector = ref('img');
const selectorAttribute = ref('src');
const listenNode = ref('');
const isImgMode = ref(true);
const markScraped = ref(false);
const isObserving = ref(false);
const renameMode = ref<RenameMode>('original');
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

// 加载已保存的模板列表
const loadTemplates = () => {
  if (typeof chrome !== 'undefined' && chrome.storage?.local) {
    chrome.storage.local.get(['scraperTemplates', 'lastSelectedTemplateId'], (res: {[key: string]: any}) => {
      console.log('[模板加载]', typeof res.scraperTemplates, res.scraperTemplates);
      if (Array.isArray(res.scraperTemplates)) {
        templateList.value = res.scraperTemplates;
      } else if (res.scraperTemplates && typeof res.scraperTemplates === 'object') {
        // 兜底兼容：如果历史数据被序列化成了 { 0: {...}, 1: {...} } 对象，自动转为数组
        templateList.value = Object.values(res.scraperTemplates);
      } else {
        templateList.value = [];
      }

      if (res.lastSelectedTemplateId) {
        selectedTemplateId.value = res.lastSelectedTemplateId;
      }
    });
  }
};


// 应用选中的模板
const applyTemplate = () => {
  if (!selectedTemplateId.value) return;
  const target = templateList.value.find(t => t.id === selectedTemplateId.value);
  if (!target) return;

  selector.value = target.selector;
  selectorAttribute.value = target.selectorAttribute;
  listenNode.value = target.listenNode || '';
  namespace.value = target.namespace || '';
  regexPattern.value = target.regexPattern ?? '\\?.*$';
  replaceText.value = target.replaceText ?? '';
  if (typeof target.isImgMode === 'boolean') isImgMode.value = target.isImgMode;
  if (typeof target.markScraped === 'boolean') markScraped.value = target.markScraped;
  if (target.renameMode) {
    renameMode.value = target.renameMode;
  } else if (typeof target.isFileRename === 'boolean') {
    renameMode.value = target.isFileRename ? 'index' : 'original';
  } else {
    renameMode.value = 'original';
  }

  saveDataToLocal('lastSelectedTemplateId', selectedTemplateId.value);
  console.log(`[模板] 已切换应用模板: ${target.name}`);
};

// 保存当前表单输入框内容为新模板
const saveCurrentAsTemplate = async () => {
  const name = newTemplateName.value.trim();
  if (!name) {
    errorMsg.value = '请输入模板名称';
    return;
  }

  const newTemplate: ScraperTemplate = {
    id: 'tpl_' + Date.now(),
    name,
    selector: selector.value,
    selectorAttribute: selectorAttribute.value,
    listenNode: listenNode.value,
    namespace: namespace.value,
    regexPattern: regexPattern.value,
    replaceText: replaceText.value,
    isImgMode: isImgMode.value,
    markScraped: markScraped.value,
    isFileRename: renameMode.value === 'index',
    renameMode: renameMode.value,
  };

  const existingIndex = templateList.value.findIndex(t => t.name === name);
  if (existingIndex > -1) {
    if (!confirm(`已存在名称为 "${name}" 的模板，是否覆盖更新？`)) {
      return;
    }
    newTemplate.id = templateList.value[existingIndex].id;
    templateList.value[existingIndex] = newTemplate;
  } else {
    templateList.value.push(newTemplate);
  }

  await saveDataToLocal('scraperTemplates', templateList.value);
  selectedTemplateId.value = newTemplate.id;
  await saveDataToLocal('lastSelectedTemplateId', newTemplate.id);

  newTemplateName.value = '';
  showSaveBox.value = false;
  errorMsg.value = '';
  console.log(`[模板] 已保存模板: ${name}`);
};

// 删除选中的模板
const deleteTemplate = async (id: string) => {
  const target = templateList.value.find(t => t.id === id);
  if (!target) return;

  if (!confirm(`确定要删除模板 "${target.name}" 吗？`)) {
    return;
  }

  templateList.value = templateList.value.filter(t => t.id !== id);
  await saveDataToLocal('scraperTemplates', templateList.value);

  if (selectedTemplateId.value === id) {
    selectedTemplateId.value = '';
    await saveDataToLocal('lastSelectedTemplateId', '');
  }
  console.log(`[模板] 已删除模板: ${target.name}`);
};

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

const handleClearList = async () => {
  imageList.value = [];
  imageStore.value.clear();
  imageStore.value = new Set();

  try {
    const [tab] = await chrome.tabs.query({active: true, currentWindow: true});
    if (tab?.id) {
      chrome.tabs.sendMessage(tab.id, {
        action: 'START_SCRAPE_FROM_SIDEBAR',
        payload: { command: 'clearMarks' }
      });
    }
  } catch (err) {
    console.warn('清空页面标记失败:', err);
  }
};

onMounted(async () => {
  loadTemplates();

  if (typeof chrome !== 'undefined' && chrome.storage?.local) {
    chrome.storage.local.get(
        ['lastSelector', 'lastSelectorAttribute', 'lastListenNode', 'lastNamespace', 'lastRegexPattern', 'lastReplaceText', 'lastRenameMode', 'lastIsFileRename', 'lastMarkScraped'],
        (result: {[key: string]: any}) => {
          if (result.lastSelector) selector.value = result.lastSelector;
          if (result.lastSelectorAttribute) selectorAttribute.value = result.lastSelectorAttribute;
          if (result.lastListenNode) listenNode.value = result.lastListenNode;
          if (result.lastNamespace) namespace.value = result.lastNamespace;
          if (result.lastRegexPattern) regexPattern.value = result.lastRegexPattern;
          if (result.lastReplaceText) replaceText.value = result.lastReplaceText;
          if (typeof result.lastMarkScraped === 'boolean') markScraped.value = result.lastMarkScraped;
          if (result.lastRenameMode) {
            renameMode.value = result.lastRenameMode;
          } else if (typeof result.lastIsFileRename === 'boolean') {
            renameMode.value = result.lastIsFileRename ? 'index' : 'original';
          }
        }
    );
  }
  await loadHistoryByNamespace();
});

watch(namespace, () => {
  loadHistoryByNamespace();
});

watch(renameMode, (val) => {
  saveDataToLocal('lastRenameMode', val);
});

watch(markScraped, (val) => {
  saveDataToLocal('lastMarkScraped', val);
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
  await saveDataToLocal('lastRenameMode', renameMode.value);
  await saveDataToLocal('lastMarkScraped', markScraped.value);

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
              markScraped: markScraped.value,
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
            processAndStoreImages(finalData, markScraped.value);
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

      // 根据选中的重命名规则生成文件名
      const cleanFilename = generateImageFilename(url, index, renameMode.value);
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

/* 模板管理样式 */
.template-section {
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  padding: 10px;
  margin-bottom: 14px;
}

.template-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 6px;
}

.template-header label {
  font-size: 13px;
  font-weight: 600;
  color: #475569;
}

.btn-text-action {
  background: none;
  border: none;
  color: #3498db;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  padding: 0;
}

.btn-text-action:hover {
  color: #2980b9;
}

.template-row {
  display: flex;
  gap: 6px;
  align-items: center;
}

.template-select {
  flex: 1;
  padding: 6px 8px;
  border: 1px solid #cbd5e1;
  border-radius: 4px;
  font-size: 13px;
  background-color: #fff;
  color: #333;
  outline: none;
}

.template-select:focus {
  border-color: #3498db;
}

.btn-delete-template {
  flex: 0 0 auto;
  background-color: #ef4444;
  color: white;
  border: none;
  border-radius: 4px;
  padding: 6px 10px;
  font-size: 12px;
  cursor: pointer;
  font-weight: normal;
}

.btn-delete-template:hover {
  background-color: #dc2626;
}

.save-template-box {
  display: flex;
  gap: 6px;
  margin-top: 8px;
}

.template-input {
  flex: 1;
  padding: 6px 8px;
  border: 1px solid #3498db;
  border-radius: 4px;
  font-size: 12px;
  box-sizing: border-box;
}

.template-input:focus {
  outline: none;
}

.btn-confirm-save {
  flex: 0 0 auto;
  background-color: #3498db;
  color: white;
  border: none;
  border-radius: 4px;
  padding: 6px 12px;
  font-size: 12px;
  cursor: pointer;
  font-weight: 600;
}

.btn-confirm-save:hover {
  background-color: #2980b9;
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

input[type="text"],
select.custom-select {
  width: 100%;
  padding: 8px 10px;
  border: 1px solid #ddd;
  border-radius: 4px;
  box-sizing: border-box;
  font-size: 13px;
  background-color: #fff;
  color: #333;
}

input[type="text"]:focus,
select.custom-select:focus {
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
  flex-wrap: wrap;
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
