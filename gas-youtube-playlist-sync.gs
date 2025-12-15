// =================================================================
// === 程式設定區塊 (使用者僅需修改此處) ===
// =================================================================

/**
 * 定義所有需要自動同步的工作表和播放清單配置。
 * 腳本將會循環處理此陣列中的每一個物件。
 * * 備註：所有欄位索引皆從 1 開始計算 (A=1, B=2, ...)
 */
const ALL_PLAYLIST_CONFIGS = [
  // --- 清單一設定範例 ---
  {
    name: "我的最愛清單",                             // 識別名稱 (顯示在 log 中)
    sheetName: '工作表1',                            // [必填] Google Sheet 工作表名稱
    videoIdColumnIndex: 2,                          // [必填] 影片網址/ID 所在的欄位索引 (例如 B 欄為 2)
    statusColumnIndex: 8,                           // [必填] 狀態標記欄位索引 (例如 H 欄為 8)
    durationColumnIndex: 3,                         // [選填] 影片時長填充欄位 (例如 C 欄為 3)
    playlistId: '您的播放清單ID',                    // [必填] YouTube 播放清單 ID
    DAILY_CAP: 50,                                  // 每日新增上限
    STATUS_MARK: '✅ 已新增'                        // 成功後寫入的標記
  },
  
  // --- 清單二設定範例 (可複製上方區塊新增更多) ---
  /*
  {
    name: "稍後觀看備份",
    sheetName: '工作表2',
    videoIdColumnIndex: 2,
    statusColumnIndex: 8,
    playlistId: 'ANOTHER_PLAYLIST_ID',
    DAILY_CAP: 50,
    STATUS_MARK: '✅ 已完成'
  }
  */
];


// =================================================================
// === 核心輔助函式 (影片 ID 解析、OEmbed、API 呼叫與格式化) ===
// =================================================================

/**
 * 從各種 YouTube 網址格式中提取出 11 碼的影片 ID。
 */
function _getVideoId(url) {
  if (!url || typeof url !== 'string') return null;

  const regex = /(?:youtu\.be\/|youtube\.com\/(?:watch\?(?:.*&)?v=|(?:embed|v|shorts)\/))([a-zA-Z0-9_-]{11})/i;
  const match = url.match(regex);
  
  if (match) {
    return match[1];
  }
  
  if (url.length === 11 && url.match(/^[a-zA-Z0-9_-]{11}$/)) {
    return url;
  }
  
  return null;
}

/**
 * 核心資料提取函式 (OEmbed 標題/作者資訊，包含快取)。
 */
function _fetchYoutubeOembedData(videoId) {
  if (!videoId || videoId.length !== 11) {
      return { error: "無效的 YouTube ID" };
  }
  
  const cache = CacheService.getScriptCache();
  const cacheKey = "YT_OEMBED_" + videoId;
  const CACHE_EXPIRY_SECONDS = 21600; // 最大 6 小時

  const cachedDataJson = cache.get(cacheKey);
  if (cachedDataJson != null) {
    return JSON.parse(cachedDataJson);
  }

  const apiUrl = 'https://www.youtube.com/oembed?url=http://www.youtube.com/watch?v=' + videoId + '&format=json';

  try {
    const response = UrlFetchApp.fetch(apiUrl);
    const json = response.getContentText();
    const data = JSON.parse(json);
    
    if (data) {
        cache.put(cacheKey, json, CACHE_EXPIRY_SECONDS);
    }
    
    return data;

  } catch (e) {
    return { error: "OEmbed 錯誤: " + e.toString() };
  }
}

/**
 * 核心函式：根據影片 ID 集合，從 YouTube API 獲取 ContentDetails (時長)。
 */
function _fetchVideoContentDetails(videoIds) {
  if (!videoIds || videoIds.length === 0) return {};
  
  try {
    const response = YouTube.Videos.list('contentDetails', {
      id: videoIds.join(','),
      maxResults: 50
    });

    const details = {};
    response.items.forEach(item => {
      details[item.id] = item.contentDetails.duration; // e.g., PT1H30M5S
    });
    return details;

  } catch (e) {
    Logger.log("Videos ContentDetails API 錯誤: " + e.message);
    return {}; 
  }
}

/**
 * 將 ISO 8601 時長字串 (PT...) 轉換為 HH:MM:SS 格式。
 */
function _formatDuration(isoDuration) {
  if (!isoDuration) return "";
  
  const matches = isoDuration.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!matches) return "";

  const hours = parseInt(matches[1] || 0, 10);
  const minutes = parseInt(matches[2] || 0, 10);
  const seconds = parseInt(matches[3] || 0, 10);
  
  const h = String(hours).padStart(2, '0');
  const m = String(minutes).padStart(2, '0');
  const s = String(seconds).padStart(2, '0');

  return `${h}:${m}:${s}`;
}

// 移除 _fetchPlaylistMetadata 函式 (不再需要)

// =================================================================
// === Google Sheet 自訂函式 (使用快取) ===
// =================================================================

/**
 * 根據 YouTube 影片的網址取得其標題。
 * @customfunction
 */
function GET_YOUTUBE_TITLE(url) {
  if (!url) return "網址不能為空";
  const videoId = _getVideoId(url);
  if (!videoId) return "無效的 YouTube 網址或 ID";

  const data = _fetchYoutubeOembedData(videoId);

  if (data && data.title) {
    return data.title;
  } else if (data && data.error) {
    return data.error;
  } else {
    return "找不到影片標題 (OEmbed 錯誤)";
  }
}

/**
 * 根據 YouTube 影片網址取得發布者 (頻道) 名稱。
 * @customfunction
 */
function GET_YOUTUBE_AUTHOR_NAME(url) {
  if (!url) return "網址不能為空";
  const videoId = _getVideoId(url);
  if (!videoId) return "無效的 YouTube 網址或 ID";

  const data = _fetchYoutubeOembedData(videoId);

  if (data && data.author_name) {
    return data.author_name;
  } else if (data && data.error) {
    return data.error;
  } else {
    return "找不到發布者名稱";
  }
}

/**
 * 根據 YouTube 影片網址取得發布者 (頻道) 網址。
 * @customfunction
 */
function GET_YOUTUBE_AUTHOR_URL(url) {
  if (!url) return "網址不能為空";
  const videoId = _getVideoId(url);
  if (!videoId) return "無效的 YouTube 網址或 ID";

  const data = _fetchYoutubeOembedData(videoId);

  if (data && data.author_url) {
    return data.author_url;
  } else if (data && data.error) {
    return data.error;
  } else {
    return "找不到發布者網址";
  }
}


// =================================================================
// === 播放清單自動化核心邏輯 (通用處理單一清單) ===
// =================================================================

/**
 * 取得指定播放清單中所有影片的 ID 集合，並對結果進行快取 (6 小時)。
 */
function getExistingVideoIds(playlistId) {
  const cache = CacheService.getScriptCache();
  const cacheKey = "EXISTING_PL_IDS_" + playlistId;
  const CACHE_EXPIRY_SECONDS = 21600; // 6 小時

  const cachedIdsJson = cache.get(cacheKey);
  if (cachedIdsJson) {
    Logger.log("從快取中讀取現有播放清單 ID。");
    return new Set(JSON.parse(cachedIdsJson));
  }

  const videoIds = new Set();
  let nextPageToken = '';
  
  Logger.log("快取過期，開始向 YouTube API 發出請求以獲取現有清單 ID...");

  while (true) {
    const response = YouTube.PlaylistItems.list('contentDetails', {
      playlistId: playlistId,
      maxResults: 50,
      pageToken: nextPageToken
    });
    
    response.items.forEach(item => {
      videoIds.add(item.contentDetails.videoId);
    });
    
    nextPageToken = response.nextPageToken;
    if (!nextPageToken) break;
  }
  
  const idsArray = Array.from(videoIds);
  cache.put(cacheKey, JSON.stringify(idsArray), CACHE_EXPIRY_SECONDS);

  Logger.log(`播放清單 ID 獲取完成，共 ${videoIds.size} 個，已存入快取。`);
  return videoIds;
}

/**
 * 根據傳入的配置，執行單一工作表到播放清單的同步作業。
 */
function processPlaylistSync(config) {
  // === 防禦性檢查 ===
  if (!config || typeof config !== 'object' || !config.name) {
    Logger.log("錯誤：processPlaylistSync 收到無效的配置物件。請檢查您的 ALL_PLAYLIST_CONFIGS 陣列或只運行 syncAllPlaylists 函式。");
    return;
  }
  
  // 從傳入的 config 物件中解構取出參數
  const { 
    name, 
    sheetName, 
    videoIdColumnIndex, 
    statusColumnIndex, 
    playlistId, 
    DAILY_CAP, 
    STATUS_MARK 
  } = config;

  Logger.log(`======== 開始處理清單：${name} (工作表: ${sheetName}) ========`);

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(sheetName);

  if (!sheet) {
    Logger.log(`致命錯誤：找不到名為 ${sheetName} 的工作表，跳過此清單。`);
    return;
  }
  
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) {
    Logger.log('工作表中沒有資料行。跳過。');
    return;
  }

  // 1. 讀取所有待處理的數據
  const startCol = Math.min(videoIdColumnIndex, statusColumnIndex);
  const endCol = Math.max(videoIdColumnIndex, statusColumnIndex);
  const numCols = endCol - startCol + 1;
  
  const dataRange = sheet.getRange(2, startCol, lastRow - 1, numCols);
  const allData = dataRange.getValues();
  
  const videoIdRelativeIndex = videoIdColumnIndex - startCol;
  const statusRelativeIndex = statusColumnIndex - startCol;

  // 2. 篩選出未處理 (狀態欄為空) 的影片
  const pendingVideos = [];
  allData.forEach((row, rowIndex) => {
    const rawUrl = row[videoIdRelativeIndex] ? row[videoIdRelativeIndex].toString().trim() : '';
    const status = row[statusRelativeIndex] ? row[statusRelativeIndex].toString().trim() : '';  
    
    if (rawUrl && status === '') {
      pendingVideos.push({
        rawUrl: rawUrl,
        rowIndex: rowIndex + 2 // 實際的 A1 行號 (從第 2 行開始)
      });
    }
  });

  Logger.log(`找到 ${pendingVideos.length} 個未處理的影片。`);

  if (pendingVideos.length === 0) {
    Logger.log('所有影片已處理完畢，無需更新。');
    return;
  }

  // 3. 獲取現有清單內容
  let existingVideoIds;
  try {
    existingVideoIds = getExistingVideoIds(playlistId);  
    Logger.log(`播放清單中已有 ${existingVideoIds.size} 個影片。`);
  } catch (e) {
    Logger.log(`嚴重錯誤：無法取得現有播放清單內容，跳過新增: ${e.message}`);
    return;
  }

  // 4. 迴圈處理、新增與狀態標記
  let addedCount = 0;
  let skippedCount = 0;
  let rangeToUpdate = []; 
  
  for (const item of pendingVideos) {
    
    if (addedCount >= DAILY_CAP) {
      Logger.log(`達到清單 ${name} 的每日新增上限 ${DAILY_CAP} 個，停止新增。`);
      break;  
    }
    
    const videoId = _getVideoId(item.rawUrl);
    
    if (!videoId) {
      Logger.log(`跳過 (無效的影片 ID): ${item.rawUrl}`);
      skippedCount++;
      continue; 
    }
    
    if (existingVideoIds.has(videoId)) {
      Logger.log(`跳過 (已存在播放清單中，將標記狀態欄): ${videoId}`);
      rangeToUpdate.push(sheet.getRange(item.rowIndex, statusColumnIndex));  
      skippedCount++;
      continue;
    }

    try {
      // 執行新增 (成本：50 單位)
      YouTube.PlaylistItems.insert({
        snippet: {
          playlistId: playlistId,
          resourceId: {
            kind: 'youtube#video',
            videoId: videoId
          }
        }
      }, 'snippet');
      
      Logger.log(`成功新增影片 ID: ${videoId}`);
      addedCount++;
      existingVideoIds.add(videoId); 
      
      rangeToUpdate.push(sheet.getRange(item.rowIndex, statusColumnIndex));  
      
      Utilities.sleep(1500); // 暫停 1.5 秒
      
    } catch (e) {
      Logger.log(`新增影片 ID: ${videoId} 時發生 API 錯誤 (行 ${item.rowIndex}): ${e.message}`);
    }
  }

  // 5. 批次更新狀態標記欄位
  if (rangeToUpdate.length > 0) {
    
    const numTotalRows = lastRow - 1;
    const allStatusUpdates = sheet.getRange(2, statusColumnIndex, numTotalRows, 1).getValues();
    const rowIndexOffset = 2; 
    
    rangeToUpdate.forEach(range => {
      const index = range.getRow() - rowIndexOffset;
      if (index >= 0 && index < numTotalRows) {
        allStatusUpdates[index][0] = STATUS_MARK;
      }
    });
    
    sheet.getRange(2, statusColumnIndex, numTotalRows, 1).setValues(allStatusUpdates);
    
    Logger.log(`已成功在工作表狀態欄上標記 ${rangeToUpdate.length} 個項目。`);
  }

  Logger.log(`--- 清單 ${name} 更新結果摘要 ---`);
  Logger.log(`已成功新增: ${addedCount} 個影片。`);
  Logger.log(`已跳過 (重複/無效): ${skippedCount} 個項目。`);
  Logger.log(`新增操作是否達到每日上限: ${addedCount >= DAILY_CAP ? '是' : '否'}`);
  Logger.log(`========================================================`);
}

/**
 * 根據傳入的配置，檢查工作表中的影片時長欄位是否為空，並填充時長。
 */
function processDurationFill(config) {
  // === 防禦性檢查 ===
  if (!config || typeof config !== 'object' || !config.name) {
    Logger.log("錯誤：processDurationFill 收到無效的配置物件。請檢查您的 ALL_PLAYLIST_CONFIGS 陣列或只運行 syncAllPlaylists 函式。");
    return;
  }
  
  const { name, sheetName, videoIdColumnIndex, durationColumnIndex } = config;
  
  if (!durationColumnIndex) {
    Logger.log(`清單 ${name} 未設定 durationColumnIndex，跳過時長填充。`);
    return;
  }
  
  Logger.log(`==== 開始填充清單 ${name} 的影片時長 (欄位 ${durationColumnIndex}) ====`);

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(sheetName);
  
  if (!sheet || sheet.getLastRow() < 2) return;

  const lastRow = sheet.getLastRow();
  const maxCol = Math.max(videoIdColumnIndex, durationColumnIndex);
  const dataRange = sheet.getRange(2, 1, lastRow - 1, maxCol);
  const allData = dataRange.getValues();
  
  const pendingVideosMap = {}; 
  
  // 1. 篩選需要查詢時長的影片
  allData.forEach((row, rowIndex) => {
    // 陣列索引 (從 0 開始) = 欄位索引 (從 1 開始) - 1
    const videoUrl = row[videoIdColumnIndex - 1] ? row[videoIdColumnIndex - 1].toString().trim() : '';
    // 時長欄位索引可能比 videoIdColumnIndex 小，需要小心處理
    const durationValue = row[durationColumnIndex - 1] ? row[durationColumnIndex - 1].toString().trim() : '';
    const videoId = _getVideoId(videoUrl);

    // 條件：有有效的影片 ID 且時長欄位為空
    if (videoId && durationValue === '') {
      pendingVideosMap[videoId] = rowIndex; 
    }
  });

  const pendingVideoIds = Object.keys(pendingVideosMap);
  Logger.log(`找到 ${pendingVideoIds.length} 個需要填充時長的影片。`);
  if (pendingVideoIds.length === 0) return;

  const durationsToUpdate = new Array(lastRow - 1).fill('');
  let apiCallCount = 0;

  // 2. 批次查詢 API (每批次 50 個)
  for (let i = 0; i < pendingVideoIds.length; i += 50) {
    const batchIds = pendingVideoIds.slice(i, i + 50);
    const apiDetails = _fetchVideoContentDetails(batchIds); // 消耗 1 單位配額
    apiCallCount++;

    for (const videoId in apiDetails) {
      const isoDuration = apiDetails[videoId];
      const formatted = _formatDuration(isoDuration);
      
      const relativeIndex = pendingVideosMap[videoId];
      if (relativeIndex !== undefined) {
        durationsToUpdate[relativeIndex] = formatted;
      }
    }
    Utilities.sleep(100); 
  }
  
  // 3. 批次寫回 Sheet
  const updateRange = sheet.getRange(2, durationColumnIndex, lastRow - 1, 1);
  const finalValues = durationsToUpdate.map(d => [d]); 
  
  updateRange.setValues(finalValues);

  Logger.log(`成功填充 ${durationsToUpdate.filter(d => d !== '').length} 筆時長。共消耗 API ${apiCallCount} 單位。`);
  Logger.log(`==== 清單 ${name} 時長填充完成 ====`);
}

// 移除 processPlaylistDescriptionUpdate 函式 (不再需要)


// =================================================================
// === 通用執行器 (此函式設定為觸發條件) ===
// =================================================================

/**
 * 創建一個自訂選單，方便手動觸發腳本功能。
 */
function onOpen() {
  SpreadsheetApp.getUi()
      .createMenu('🎬 播放清單管理')
      .addItem('🔄 立即同步所有清單', 'syncAllPlaylists') 
      .addSeparator()
      .addItem('❓ 僅填充所有清單的影片時長', 'runDurationFillForAll') 
      .addToUi();
}

/**
 * 總執行器：僅循環運行所有配置中的時長填充任務。
 */
function runDurationFillForAll() {
  const ui = SpreadsheetApp.getUi();
  if (!ALL_PLAYLIST_CONFIGS || ALL_PLAYLIST_CONFIGS.length === 0) {
    ui.alert("配置錯誤", "ALL_PLAYLIST_CONFIGS 陣列為空，請檢查設定。", ui.ButtonSet.OK);
    return;
  }
  
  ui.alert('開始更新', `將對 ${ALL_PLAYLIST_CONFIGS.length} 個工作表進行時長填充，請稍候。`, ui.ButtonSet.OK);

  let successCount = 0;
  for (const config of ALL_PLAYLIST_CONFIGS) {
    try {
      processDurationFill(config);
      successCount++;
    } catch (e) {
      Logger.log(`致命錯誤：手動填充清單 ${config.name} 時失敗: ${e.message}`);
    }
  }
  
  ui.alert('更新完成', `成功為 ${successCount} 個工作表填充時長，請查看日誌了解詳情。`, ui.ButtonSet.OK);
}

/**
 * 腳本的總入口點。循環處理 ALL_PLAYLIST_CONFIGS 中定義的所有同步任務。
 * **此函式應設定為時間驅動觸發條件 (Time-driven Trigger)。**
 */
function syncAllPlaylists() {
  if (!ALL_PLAYLIST_CONFIGS || ALL_PLAYLIST_CONFIGS.length === 0) {
    Logger.log("錯誤：ALL_PLAYLIST_CONFIGS 陣列為空，請檢查配置。腳本停止運行。");
    return;
  }
  
  Logger.log(`--- 偵測到 ${ALL_PLAYLIST_CONFIGS.length} 個待處理清單，開始循環同步 ---`);

  // 循環處理每一個配置
  for (const config of ALL_PLAYLIST_CONFIGS) {
    try {
      // 1. 填充單個影片時長 (Sheet 永久快取)
      processDurationFill(config); 
      
      // 2. 核心播放清單同步 (新增影片)
      processPlaylistSync(config); 
      
      // 移除更新描述的步驟

      // 每次處理完一個清單後加入延遲
      Utilities.sleep(3000); 
    } catch (e) {
      Logger.log(`致命錯誤：處理清單 ${config.name || config.sheetName} 時失敗: ${e.message}`);
    }
  }
  
  Logger.log("--- 所有清單同步任務完成 ---");
}