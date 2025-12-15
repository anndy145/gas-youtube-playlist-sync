# GAS YouTube Playlist Sync

這是一個 Google Apps Script 工具，能自動將 Google Sheet 中的影片連結同步到 YouTube 播放清單。

## ✨ 主要功能
*   **自動同步**：定期掃描並新增影片，支援多個播放清單。
*   **智慧管理**：自動去重、配額控管 (每日上限)、狀態標記。
*   **輔助工具**：提供自訂選單手動同步，以及影片時長自動填充功能。
*   **自訂函式**：提供 `=GET_YOUTUBE_TITLE(url)` 等函式直接抓取影片資訊。

## 🚀 快速開始

### 1. 安裝
1.  建立 Google Sheet，準備 **影片連結** (例如 B 欄) 與 **狀態標記** (例如 H 欄) 欄位。
2.  `擴充功能` > `Apps Script` > 貼上 `gas-youtube-playlist-sync.gs` 程式碼。
3.  在編輯器左側 `服務` (Services) 加入 **YouTube Data API v3**。

### 2. 設定
在程式碼頂部修改 `ALL_PLAYLIST_CONFIGS`：
```javascript
const ALL_PLAYLIST_CONFIGS = [{
    name: "我的清單",
    sheetName: '工作表1',
    videoIdColumnIndex: 2,   // B欄
    statusColumnIndex: 8,    // H欄
    durationColumnIndex: 3,  // [選填] C欄 (自動填入時長)
    playlistId: 'YOUR_PLAYLIST_ID',
    DAILY_CAP: 50,
    STATUS_MARK: '✅ 已新增'
}];
```

### 3. 執行與授權
1.  **首次執行**：在編輯器執行 `syncAllPlaylists` 函式，並完成 **權限授權**。
2.  **自動化**：在 `觸發條件` (鬧鐘圖示) 新增 `syncAllPlaylists` 的 **時間驅動** 觸發 (建議每小時)。

## 📋 使用說明
*   **選單操作**：Refresh Sheet 後可看到 `🎬 播放清單管理` 選單，可手動同步或填充時長。
*   **自訂函式**：
    *   `GET_YOUTUBE_TITLE(url)`：影片標題
    *   `GET_YOUTUBE_AUTHOR_NAME(url)`：頻道名稱
    *   `GET_YOUTUBE_AUTHOR_URL(url)`：頻道網址

> **⚠️ 注意**：新增影片成本較高 (50 單位/次)，請留意 `DAILY_CAP` 設定以節省配額。
