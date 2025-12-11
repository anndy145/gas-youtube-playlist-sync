# Google Apps Script - YouTube 播放清單自動同步工具

這是一個 Google Apps Script 專案，可以幫助您將 Google Sheet 中的 YouTube 影片連結自動同步到指定的 YouTube 播放清單。

## ✨ 主要功能

*   **自動同步**：定期檢查 Google Sheet 中的新影片連結，並自動新增至 YouTube 播放清單。
*   **智慧去重**：自動檢查播放清單中是否已存在該影片，避免重複新增。
*   **配額管理**：內建每日新增上限 (預設 50 個)，避免超過API 的每日配額限制。
*   **狀態追蹤**：同步成功後，會自動在 Google Sheet 的指定欄位標記狀態 (例如：`✅ 已新增`)。
*   **自訂函式**：提供額外的試算表函數，可直接抓取影片資訊(不消耗API配額)：
    *   `GET_YOUTUBE_TITLE(url)`：取得影片標題
    *   `GET_YOUTUBE_AUTHOR_NAME(url)`：取得頻道名稱
    *   `GET_YOUTUBE_AUTHOR_URL(url)`：取得頻道網址

## 🚀 安裝與設定教學

### 1. 準備 Google Sheet
1. 建立一個新的 Google Sheet。
2. 在工作表中準備好您的資料，至少需要有一欄是放 **YouTube 影片連結**。
3. 預留一欄作為 **狀態標記** (例如 H 欄)。

### 2. 建立 Google Apps Script 專案
1. 在 Google Sheet 中，點選選單列的 `擴充功能` > `Apps Script`。
2. 將 `gas-youtube-playlist-sync.gs` 的內容複製並貼上到腳本編輯器中。

### 3. 未用到的步驟: 首次手動執行與授權 (重要！)
在設定自動化之前，您**必須**手動執行一次以授權腳本存取您的帳戶：
1. 在 Apps Script 編輯器上方，將欲執行的函式選為 `addVideosToPlaylistOptimized_V2`。
2. 點擊 `執行` (Run) 按鈕。
3. 系統會跳出「需要審查權限」的視窗，請點擊「審查權限」。
4. 選擇您的 Google 帳戶，若出現「Google 尚未驗證應用程式」警示，請點擊「進階」並選擇「前往... (不安全)」（因為這是您自己寫的腳本）。
5. 點擊「允許」以授予腳本存取試算表與 YouTube 的權限。

### 4. 修改設定參數
在程式碼的最上方 `PLAYLIST_CONFIG` 區域，填入您的設定資訊：

```javascript
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
```

### 5. 設定自動化觸發 (Triggers)
讓腳本根據自己的需求設定觸發條件，無需手動操作：
1. 在 Apps Script 左側側邊欄，點擊 `觸發條件` (鬧鐘圖示)。
2. 點擊右下角的 `新增觸發條件`。
3. 設定如下：
    *   **執行功能的名稱**：`addVideosToPlaylistOptimized_V2`
    *   **活動來源**：`時間驅動`
    *   **觸發條件類型**：`小時計時器` (根據自己的需求設定)

## 📋 使用說明

### 1. 播放清單同步
*   **新增影片**：只要在 Google Sheet 的指定欄位貼上 YouTube 連結，腳本下次執行時就會自動抓取並新增到播放清單。
*   **查看狀態**：處理完成的影片，狀態欄位會自動顯示 `✅ 已新增`。

### 2. Google Sheets 自訂函式範例
您可以直接在 Google Sheet 儲存格中使用以下函式（假設網址在 A2）：

| 函式名稱 | 說明 | 範例 |
| :--- | :--- | :--- |
| `GET_YOUTUBE_TITLE(url)` | 獲取影片標題 | `=GET_YOUTUBE_TITLE(A2)` |
| `GET_YOUTUBE_AUTHOR_NAME(url)` | 獲取頻道名稱 | `=GET_YOUTUBE_AUTHOR_NAME(A2)` |
| `GET_YOUTUBE_AUTHOR_URL(url)` | 獲取頻道網址 | `=GET_YOUTUBE_AUTHOR_URL(A2)` |

## ⚠️ 注意事項與配額

*   **API 配額成本**：YouTube Data API 每日有配額限制 (通常為 10,000 單位)。
    *   讀取現有清單：約 1 單位 / 頁。
    *   **新增影片 (`insert`)：成本較高，約 50 單位 / 次**。
    *   請留意 `DAILY_CAP` 設定，預設 50 次新增約消耗 2,500 單位，屬於安全範圍。
*   **智慧快取**：
    *   播放清單 ID：快取 12 小時。
    *   OEmbed 資訊 (標題/作者)：快取 6 小時，減少 API 呼叫。
*   **網址格式**：支援標準網址 (`youtube.com/watch?v=...`)、短網址 (`youtu.be/...`) 與 Shorts 連結。
