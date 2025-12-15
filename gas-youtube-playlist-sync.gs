// =================================================================
// === 程式設定區塊 (使用者僅需修改此處) ===
// =================================================================

/**
 * 定義所有需要自動同步的工作表和播放清單配置。
 * 腳本將會循環處理此陣列中的每一個物件。
 */
const ALL_PLAYLIST_CONFIGS = [
  // 清單一 
  {
    name: "主要羌樂清單", 
    sheetName: '羌樂',                               // [必填] 工作表名稱
    videoIdColumnIndex: 2,                          // [必填] 影片網址/ID 所在的欄位索引 (例如 B 欄為 2)
    statusColumnIndex: 8,                           // [必填] 狀態標記欄位索引 (例如 H 欄為 8)
    playlistId: 'PLE-SVZw6GxvgAe-Q7Ox85rCCKcpEwsHP5', // [必填] 您的 YouTube 播放清單 ID
    DAILY_CAP: 50,                                  // 每日新增上限
    STATUS_MARK: '✅ 已新增'                        // 成功後寫入的標記
  },
  
  // 清單二
  
  {
    name: "備用歌單",
    sheetName: '羌片', 
    videoIdColumnIndex: 2,                          
    statusColumnIndex: 6,                           
    playlistId: 'PLE-SVZw6GxvhJAFpaMcdAzyXhf61gUt-Z', 
    DAILY_CAP: 50,           
    STATUS_MARK: '✅ 已完成' 
  }
  
];


// =================================================================
// === 核心輔助函式 (影片 ID 解析與 OEmbed 資料獲取/快取) ===
// =================================================================

/**
 * 從各種 YouTube 網址格式中提取出 11 碼的影片 ID。
 * @param {string} url 完整的 YouTube 網址或影片 ID。
 * @return {string | null} 11 碼的影片 ID，如果無法解析則返回 null。
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
 * @param {string} videoId 11 碼的 YouTube 影片 ID。
 * @return {object} OEmbed JSON 資料或包含錯誤訊息的物件。
 */
function _fetchYoutubeOembedData(videoId) {
  if (!videoId || videoId.length !== 11) {
      return { error: "無效的 YouTube ID" };
  }
  
  const cache = CacheService.getScriptCache();
  const cacheKey = "YT_OEMBED_" + videoId;

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
        cache.put(cacheKey, json, 21600); // 快取 6 小時
    }
    
    return data;

  } catch (e) {
    return { error: "OEmbed 錯誤: " + e.toString() };
  }
}

// =================================================================
// === Google Sheet 自訂函式 (使用快取) ===
// =================================================================

/**
 * 根據 YouTube 影片的網址取得其標題。
 * @param {string} url 完整的 YouTube 網址或影片 ID。
 * @return {string} 影片標題。
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
 * @param {string} url 完整的 YouTube 網址或影片 ID。
 * @return {string} 頻道名稱。
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
 * @param {string} url 完整的 YouTube 網址或影片 ID。
 * @return {string} 頻道網址。
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
 * 取得指定播放清單中所有影片的 ID 集合，並對結果進行快取 (12 小時)。
 * @param {string} playlistId 播放清單 ID。
 * @return {Set<string>} 現有影片 ID 的集合。
 */
function getExistingVideoIds(playlistId) {
  const cache = CacheService.getScriptCache();
  const cacheKey = "EXISTING_PL_IDS_" + playlistId;
  const CACHE_EXPIRY_SECONDS = 43200; // 12 小時

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
 * @param {object} config 包含 sheetName, playlistId 等參數的配置物件。
 */
function processPlaylistSync(config) {
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

  // 3. 執行 API 檢查 (獲取現有清單，使用快取)
  let existingVideoIds;
  try {
    existingVideoIds = getExistingVideoIds(playlistId);  
    Logger.log(`播放清單中已有 ${existingVideoIds.size} 個影片。`);
  } catch (e) {
    Logger.log(`嚴重錯誤：無法取得現有播放清單內容，請檢查 YouTube Data API 權限或配額是否不足: ${e.message}`);
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


// =================================================================
// === 通用執行器 (此函式設定為觸發條件) ===
// =================================================================

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
      processPlaylistSync(config);
      // 在處理完每個清單後加入延遲，有助於分散 API 呼叫，降低被限速的風險。
      Utilities.sleep(3000); 
    } catch (e) {
      Logger.log(`致命錯誤：處理清單 ${config.name || config.sheetName} 時失敗: ${e.message}`);
    }
  }
  
  Logger.log("--- 所有清單同步任務完成 ---");
}