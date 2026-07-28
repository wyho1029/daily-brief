// 每日情報：叫 Gemini 攞資料 → 寫入 data/ → 推去 Discord
import { writeFile, mkdir, readdir } from 'node:fs/promises';

const MODEL = 'gemini-2.5-flash';
const KEY = process.env.GEMINI_API_KEY;
const HOOKS = (process.env.DISCORD_WEBHOOK_URL || '')
  .split(',').map((s) => s.trim()).filter(Boolean);
if (!KEY || !HOOKS.length) throw new Error('缺少 GEMINI_API_KEY 或 DISCORD_WEBHOOK_URL');

// ponytail: UTC+8 靠加 8 小時再切 ISO，唔使 timezone library
const today = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);

const TOPICS = {
  tech:   { emoji: '🔬', name: '科技',     color: 0x4f9dff },
  ai:     { emoji: '🤖', name: 'AI',       color: 0x9b59b6 },
  stocks: { emoji: '📈', name: '美股',     color: 0x2ecc71 },
  crypto: { emoji: '₿',  name: '加密貨幣', color: 0xf1c40f },
};

const prompt = `你係一個專業嘅科技財經情報分析員。今日係 ${today}（香港時間）。
請用 Google 搜尋最新資訊，產出一份繁體中文情報報告，分兩部分。

Part 1 — 過去一週回顧：分四個主題（科技 tech、AI、美股 stocks、加密貨幣 crypto）。
每個主題列 3-5 條最重要嘅事，每條一個簡短標題加 1-2 句繁體中文摘要。

Part 2 — 未來大事預告（未來一個月內）：
- scheduled：高確定性、已排程嘅事（議息、CPI/非農等數據、重磅財報、產品發布會、
  token unlock、ETF 審批死線等），每條附確切或預計日期（YYYY-MM-DD）。
- speculation：2-4 條明確屬於推測嘅前瞻，每條附簡短理由。

⚠️ 只可以輸出一個 JSON 物件，唔好有任何其他文字、唔好用 markdown 圍欄。格式：
{
  "date": "${today}",
  "pastWeek": {
    "tech":   [{"title":"...","summary":"..."}],
    "ai":     [{"title":"...","summary":"..."}],
    "stocks": [{"title":"...","summary":"..."}],
    "crypto": [{"title":"...","summary":"..."}]
  },
  "upcoming": {
    "scheduled":   [{"date":"YYYY-MM-DD","title":"...","note":"..."}],
    "speculation": [{"title":"...","rationale":"..."}]
  }
}`;

/** 由可能含圍欄 / 雜訊嘅文字抽出 JSON。 */
function extractJson(text) {
  const s = String(text || '').trim();
  const first = s.indexOf('{');
  const last = s.lastIndexOf('}');
  if (first === -1 || last <= first) throw new Error('搵唔到 JSON：' + s.slice(0, 200));
  return JSON.parse(s.slice(first, last + 1));
}

async function callGemini() {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${KEY}`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        tools: [{ google_search: {} }],
        generationConfig: { temperature: 0.4 },
      }),
    },
  );
  if (!res.ok) throw new Error(`Gemini HTTP ${res.status}：${(await res.text()).slice(0, 300)}`);
  const data = await res.json();
  const parts = data?.candidates?.[0]?.content?.parts;
  if (!parts) throw new Error('Gemini 回傳格式異常：' + JSON.stringify(data).slice(0, 300));
  return extractJson(parts.map((p) => p.text || '').join(''));
}

/** 報告要有實質內容先算數（今朝就係空報告照 send 咗標題）。 */
function countItems(r) {
  return Object.values(r?.pastWeek || {}).flat().length
    + (r?.upcoming?.scheduled?.length || 0)
    + (r?.upcoming?.speculation?.length || 0);
}

function chunk(text, limit = 4000) {
  const out = [];
  let s = text;
  while (s.length > limit) {
    let cut = s.lastIndexOf('\n', limit);
    if (cut < limit * 0.5) cut = limit;
    out.push(s.slice(0, cut));
    s = s.slice(cut).replace(/^\n+/, '');
  }
  if (s) out.push(s);
  return out;
}

function buildEmbeds(r) {
  const embeds = [];
  const add = (title, color, body) =>
    chunk(body).forEach((part, i) =>
      embeds.push({ title: title + (i ? '（續）' : ''), description: part, color }));

  for (const [key, m] of Object.entries(TOPICS)) {
    const items = r.pastWeek?.[key] || [];
    if (items.length) {
      add(`${m.emoji} ${m.name}`, m.color,
        items.map((it) => `**${it.title}**\n${it.summary}`).join('\n\n'));
    }
  }
  const sched = r.upcoming?.scheduled || [];
  if (sched.length) {
    add('📅 未來排程', 0xe67e22,
      sched.map((it) => `\`${it.date}\` **${it.title}**${it.note ? '\n' + it.note : ''}`).join('\n\n'));
  }
  const spec = r.upcoming?.speculation || [];
  if (spec.length) {
    add('🔮 AI 推測（僅供參考，非事實）', 0x95a5a6,
      spec.map((it) => `**${it.title}**\n${it.rationale}`).join('\n\n'));
  }
  return embeds;
}

/** 按 Discord 限制分批：最多 10 個 embed、總字數 < 6000。 */
function batch(embeds) {
  const out = [];
  let cur = [], chars = 0;
  for (const e of embeds) {
    const len = e.title.length + e.description.length;
    if (cur.length >= 10 || (cur.length && chars + len > 5800)) { out.push(cur); cur = []; chars = 0; }
    cur.push(e);
    chars += len;
  }
  if (cur.length) out.push(cur);
  return out;
}

async function post(payload) {
  for (const url of HOOKS) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) console.error(`Discord HTTP ${res.status}：${(await res.text()).slice(0, 200)}`);
  }
}

async function main() {
  const report = await callGemini();
  if (countItems(report) === 0) throw new Error('Gemini 回傳咗空報告');
  report.date = today;

  await mkdir('data', { recursive: true });
  await writeFile(`data/${today}.json`, JSON.stringify(report, null, 2));
  const dates = (await readdir('data'))
    .filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f))
    .map((f) => f.slice(0, 10))
    .sort().reverse();
  await writeFile('data/index.json', JSON.stringify(dates, null, 2));

  const batches = batch(buildEmbeds(report));
  for (const [i, embeds] of batches.entries()) {
    await post({
      username: '每日情報',
      ...(i === 0 && { content: `📰 **每日情報 ${today}**` }),
      embeds,
    });
  }
  console.log(`完成：${today}，${countItems(report)} 條、${batches.length} 個訊息。`);
}

main().catch(async (err) => {
  await post({ username: '每日情報', content: `⚠️ 今朝情報產出失敗：${err.message}` });
  console.error(err);
  process.exit(1);
});
