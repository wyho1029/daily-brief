# 每日情報

每朝香港時間 6 點自動用 Gemini 搜尋科技 / AI / 美股 / 加密貨幣資訊，推去 Discord，並存檔喺網站。

- **定時**：GitHub Actions（`.github/workflows/daily.yml`）
- **內容**：Gemini API + Google 搜尋（`scripts/brief.mjs`）
- **存檔**：`data/YYYY-MM-DD.json`
- **網站**：GitHub Pages（`index.html`）

## 安裝

### 1. 開 repo
GitHub → New repository → 名隨意（例：`daily-brief`）→ **Public**（免費用 Pages 要 public）→ Create。

### 2. 上載檔案
Repo 頁面 → **Add file → Upload files** → 將呢個資料夾入面嘅嘢全部拉入去 →
（`.github` 資料夾都要，如果拉唔到就用 **Create new file**，檔名打
`.github/workflows/daily.yml` 再貼內容）→ Commit。

### 3. 加密鑰
Settings → **Secrets and variables → Actions** → New repository secret，加兩個：

| Name | Secret |
|---|---|
| `GEMINI_API_KEY` | 你嘅 Gemini key（https://aistudio.google.com/apikey） |
| `DISCORD_WEBHOOK_URL` | Discord webhook URL；**多過一個就用逗號分隔** |

### 4. 開 Pages
Settings → **Pages** → Source 揀 `Deploy from a branch` → Branch `main` / `(root)` → Save。
網址：`https://<你嘅帳號>.github.io/<repo名>/`

### 5. 試跑
Actions 分頁 → 左邊揀「每日情報」→ **Run workflow** → 等一兩分鐘。
Discord 應該收到，`data/` 亦會多咗一個 JSON。

## 日常

- 每日 22:00 UTC（= 香港 06:00）自動跑。GitHub 排程繁忙時可能遲幾分鐘至半個鐘。
- 出錯會推一條 ⚠️ 通知去 Discord，唔會靜靜地失敗。
- 想即刻跑一次：Actions → Run workflow。
- 想改內容主題：改 `scripts/brief.mjs` 頂部個 `prompt`。
