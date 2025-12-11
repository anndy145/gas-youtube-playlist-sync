// =================================================================
// === 程式設定區塊 (使用者僅需修改此處) ===
// =================================================================

const PLAYLIST_CONFIG = {
  // 1. Google Sheet 設定
  sheetName: '工作表名稱',           // 您的工作表名稱 (例如: '工作表1')
  videoIdColumnIndex: 2,            // 影片連結在哪一欄 (A=1, B=2, ...)
  statusColumnIndex: 8,             // 狀態標記要填在哪一欄 (H=8)
  
  // 2. YouTube API 設定
  playlistId: '您的播放清單ID',      // YouTube 播放清單 ID (從網址中 list= 後面的字串)
  DAILY_CAP: 50,                    // 每日新增上限
  
  // 3. 狀態標記文字
  STATUS_MARK: '✅ 已新增'          // 完成後要顯示的文字
};

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

  // 匹配所有常見格式：watch?v=, shorts/, embed/, v/, youtu.be/
  const regex = /(?:youtu\.be\/|youtube\.com\/(?:watch\?(?:.*&)?v=|(?:embed|v|shorts)\/))([a-zA-Z0-9_-]{11})/i;
  const match = url.match(regex);
  
  if (match) {
    return match[1];
  }
  
  // 如果輸入本身就是一個看似有效的 11 碼 ID
  if (url.length === 11 && url.match(/^[a-zA-Z0-9_-]{11}$/)) {
    return url;
  }
  
  return null;
}

/**
 * 核心資料提取函式 (包含快取)。
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
        cache.put(cacheKey, json, 21600); // 6 小時
    }
    
    return data;

  } catch (e) {
    return { error: "錯誤: " + e.toString() };
  }
}

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
    return "找不到影片標題 (API 錯誤)";
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
// === 播放清單自動化管理 (定時更新、使用 H 欄標記、限制配額) ===
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

  // 1. 嘗試從快取中讀取
  const cachedIdsJson = cache.get(cacheKey);
  if (cachedIdsJson) {
    Logger.log("從快取中讀取現有播放清單 ID。");
    return new Set(JSON.parse(cachedIdsJson));
  }

  // 2. 快取過期或不存在，發出 API 請求
  const videoIds = new Set();
  let nextPageToken = '';
  
  Logger.log("快取過期，開始向 YouTube API 發出請求以獲取現有清單 ID...");

  // 透過分頁取得所有影片 ID
  while (true) {
    // 每次呼叫成本 1 單位
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
  
  // 3. 將新的 ID 列表存入快取
  const idsArray = Array.from(videoIds);
  cache.put(cacheKey, JSON.stringify(idsArray), CACHE_EXPIRY_SECONDS);

  Logger.log(`播放清單 ID 獲取完成，共 ${videoIds.size} 個，已存入快取。`);
  return videoIds;
}

/**
 * 根據 Google Sheet 中的網址/ID，定時優化地更新 YouTube 播放清單。
 * **此版本已移除 ui.alert()，確保可透過時間驅動觸發條件自動執行。**
 */
function addVideosToPlaylistOptimized_V2() {
  // 從全域設定中解構取出參數
  const { 
    sheetName, 
    videoIdColumnIndex, 
    statusColumnIndex, 
    playlistId, 
    DAILY_CAP, 
    STATUS_MARK 
  } = PLAYLIST_CONFIG;

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(sheetName);

  if (!sheet) {
    Logger.log(`致命錯誤：找不到名為 ${sheetName} 的工作表，腳本停止運行。`);
    return;
  }
  
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) {
    Logger.log('工作表中沒有資料行。腳本停止運行。');
    return;
  }

  // 1. 讀取所有待處理的數據
  const startCol = Math.min(videoIdColumnIndex, statusColumnIndex);
  const endCol = Math.max(videoIdColumnIndex, statusColumnIndex);
  const numCols = endCol - startCol + 1;
  
  const dataRange = sheet.getRange(2, startCol, lastRow - 1, numCols);
  const allData = dataRange.getValues();
  
  // 計算在讀取的範圍內，影片ID欄和狀態欄的相對索引
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
  let rangeToUpdate = []; // 用於收集所有需要被標記的儲存格
  
  for (const item of pendingVideos) {
    
    // 檢查是否已達每日新增上限
    if (addedCount >= DAILY_CAP) {
      Logger.log(`達到每日新增上限 ${DAILY_CAP} 個，停止新增。`);
      break;  
    }
    
    const videoId = _getVideoId(item.rawUrl);
    
    if (!videoId) {
      Logger.log(`跳過 (無效的影片 ID): ${item.rawUrl}`);
      skippedCount++;
      continue; 
    }
    
    // 檢查是否已存在播放清單中
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
      existingVideoIds.add(videoId); // 新增成功後立即更新 Set
      
      // 標記狀態欄為成功
      rangeToUpdate.push(sheet.getRange(item.rowIndex, statusColumnIndex));  
      
      Utilities.sleep(1500); // 暫停 1.5 秒
      
    } catch (e) {
      Logger.log(`新增影片 ID: ${videoId} 時發生 API 錯誤 (行 ${item.rowIndex}): ${e.message}`);
    }
  }

  // 5. 批次更新狀態標記欄位
  if (rangeToUpdate.length > 0) {
    // 為了實現批次更新，我們需要找到要更新的連續範圍
    
    // 取得所有要更新的行號，並排序
    const rows = rangeToUpdate.map(range => range.getRow()).sort((a, b) => a - b);
    
    if (rows.length > 0) {
      // 找出起始行和結束行
      const startRow = rows[0];
      const endRow = rows[rows.length - 1];
      const numRows = endRow - startRow + 1;
      
      // 讀取這整個範圍的現有值
      const statusRange = sheet.getRange(startRow, statusColumnIndex, numRows, 1);
      const statusValues = statusRange.getValues();
      
      let updateCount = 0;
      
      // 只有在原本是空值，且行號在需要更新的列表中時才填入標記
      for (let i = 0; i < numRows; i++) {
        const currentRow = startRow + i;
        if (rows.includes(currentRow)) {
          // 只有原本狀態為空才寫入，但由於我們篩選的 `rangeToUpdate` 已經是未處理的，這裡可以直接寫入
          // 為了確保效率，且避免跳過中間未處理項目的行被寫入，這裡使用一個更簡單的實現：
          // 將所有要更新的範圍值設為 STATUS_MARK
          // 注意：這個簡單實現在 sheets API 中可能很慢，但由於 rangeToUpdate 的範圍不連續，
          // Google Apps Script 的 getRange(...).setValues() 需要連續範圍。
          // 
          // 最可靠的方法是單獨更新每個儲存格，但為了批次效率，我們將所有要更新的範圍設為一個單獨的陣列，
          // 並使用一個大的連續範圍來更新，只更新確實需要更新的行。
          
          // 重新整理 rangeToUpdate 數組，讓它可以被 setValues() 批次處理
          const allStatusUpdates = sheet.getRange(2, statusColumnIndex, lastRow - 1, 1).getValues();
          const rowIndexOffset = 2;
          
          rangeToUpdate.forEach(range => {
            const index = range.getRow() - rowIndexOffset;
            allStatusUpdates[index][0] = STATUS_MARK;
          });
          
          sheet.getRange(2, statusColumnIndex, lastRow - 1, 1).setValues(allStatusUpdates);
          updateCount = rangeToUpdate.length;
          break; // 跳出內層循環，因為我們執行了一次大範圍更新
        }
      }

      Logger.log(`已成功在工作表狀態欄上標記 ${updateCount} 個項目 (包含新增成功的和已存在的)。`);
    }
  }

  Logger.log('所有影片處理完成。');
  Logger.log(`--- 播放清單更新結果 ---`);
  Logger.log(`已成功新增: ${addedCount} 個影片。`);
  Logger.log(`已跳過 (重複或無效): ${skippedCount} 個項目。`);
  Logger.log(`總計在狀態欄標記完成: ${rangeToUpdate.length} 個項目。`);
  Logger.log(`新增操作是否達到每日上限: ${addedCount >= DAILY_CAP ? '是' : '否'}`);
}