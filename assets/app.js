// assets/app.js（全文差し替え）

const $ = (s) => document.querySelector(s);
const canvas = $("#preview");
const ctx = canvas.getContext("2d");

// 追加：読み込んだJSONのファイル名（フッター表示・採点用識別）
let __sourceFilename = "";
function setSourceFilename(name) {
  __sourceFilename = (name || "").toString();
}

// 追加：DPRに合わせてキャンバスをスケール（横長 1700x1200）
function setupCanvasForDPR() {
  const dpr = window.devicePixelRatio || 1;
  const cssW = 1700, cssH = 1200; // 横長
  canvas.style.width = cssW + "px";
  canvas.style.height = cssH + "px";
  canvas.width = Math.floor(cssW * dpr);
  canvas.height = Math.floor(cssH * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

// 直近に読み込んだオリジナルJSON（ラウンドトリップ）
let __lastImportedOriginal = null;
// questions を持っているときはここに保持（描画で使う）
let __questions = null;

/* ---------------- Utils ---------------- */
function toWordsList(raw) {
  return raw.split(/[\n,]/).map(s => s.trim()).filter(Boolean);
}
function fromWordsList(list) { return (list || []).join("\n"); }

function parseParams() {
  const p = new URLSearchParams(location.search);
  const wordsParam = p.get("words");
  const colsParam = p.get("cols");
  const auto = p.get("auto");
  const words = wordsParam ? toWordsList(wordsParam) : toWordsList($("#words").value);
  const cols = colsParam ? parseInt(colsParam, 10) : (parseInt($("#cols").value, 10) || 2);
  return { words, cols, auto };
}

/* 共通：縦書き1文字ずつ（句読点の位置補正 強め） */
function drawVerticalText({ text, x, y, lineH = 36, font = "32px serif" }) {
  ctx.save();
  ctx.font = font;
  ctx.fillStyle = "#000";
  ctx.textAlign = "center";
  ctx.textBaseline = "top";

  // 句読点・記号を右に寄せる
  const xAdjust = {
    "。": 24, "、": 24, "．": 24, "，": 24,
    "・": 12, "！": 10, "？": 10,
    "」": 8, "』": 8, "）": 8, "］": 8, "｝": 8
  };

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const dx = xAdjust[ch] || 0;
    ctx.fillText(ch, x + dx, y + i * lineH);
  }
  ctx.restore();
}

/* 共通：番号の丸 */
function drawNumberCircle({ n, x, y, r = 16 }) {
  ctx.save();
  ctx.beginPath();
  ctx.lineWidth = 2;
  ctx.strokeStyle = "#222";
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.stroke();
  ctx.font = "16px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#111";
  ctx.fillText(String(n), x, y);
  ctx.restore();
}

/* 共通：マス＋ふりがな（ふりがなは右側・大きめ） */
function drawKanjiBoxesWithFurigana({ x, y, count, box = 64, gap = 8, yomigana = "" }) {
  ctx.save();
  ctx.strokeStyle = "#111";
  ctx.lineWidth = 2;

  const totalH = count * (box + gap) - gap;
  ctx.strokeRect(x - box/2, y, box, totalH);

  for (let i = 1; i < count; i++) {
    const yy = y + i * (box + gap) - gap/2;
    ctx.beginPath();
    ctx.moveTo(x - box/2, yy);
    ctx.lineTo(x + box/2, yy);
    ctx.stroke();
  }

  // ふりがな（右側・大きめ。OCR/視認性を上げる）
  if (yomigana) {
    drawVerticalText({
      text: yomigana,
      x: x + box/2 + 7,   // 右へオフセット（見やすさ優先）
      y: y + 9,
      lineH: 26,
      font: "22px serif"   // ★ 14px → 22px に拡大
    });
  }

  ctx.restore();
  return totalH;
}

/* ---------------- Drawing ---------------- */

function drawWords({ words, cols = 2 }) {
  // 背景
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, 1700, 1200);

  const padding = 80;
  const contentW = 1700 - padding * 2;  // 横長幅
  const contentH = 1200 - padding * 2;  // 横長高さ

  // 外枠
  ctx.strokeStyle = "#e5e5e5";
  ctx.lineWidth = 1;
  ctx.strokeRect(padding, padding, contentW, contentH);

  // 文字
  ctx.fillStyle = "#000";
  ctx.font = "32px serif";

  const colWidth = Math.floor(contentW / cols);
  const lineGap = 64;

  words.forEach((w, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const xRight = padding + colWidth * (col + 1) - 24;
    const yTop = padding + 64 + row * lineGap;

    const step = 34;
    for (let k = 0; k < w.length; k++) {
      const ch = w[k];
      const x = xRight - (step * k);
      const y = yTop;
      ctx.fillText(ch, x, y);
    }

    const width = step * w.length + 24;
    ctx.strokeStyle = "#ddd";
    ctx.strokeRect(xRight - width + 12, yTop - 40, width, 48);
  });
}

/* B) questions 形式：番号・ふりがな・空欄・縦書き文（横長 1700x1200） */
function drawQuestions({ questions }) {
  // 背景（横長）
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, 1700, 1200);

  // 版面（横長）
  const PAD_X = 64;
  const PAD_Y = 40;
  const W = 1700 - PAD_X * 2;
  const H = 1200 - PAD_Y * 2;

  // 中央線（上下2段）
  const MID_Y = PAD_Y + H / 2;
  ctx.strokeStyle = "#999";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(PAD_X, MID_Y);
  ctx.lineTo(PAD_X + W, MID_Y);
  ctx.stroke();

  // 段設定（間隔を詰める）
  const ROW_GAP_TOP = 6;
  const ROW_GAP_BOTTOM = 6;
  const ROW_HEIGHT = H / 2 - ROW_GAP_TOP - ROW_GAP_BOTTOM;

  // 列設定（右→左に10列）
  const COLS = 10;
  const COL_W = W / COLS;

  // 行間・マスサイズ設定（本文は詰め気味／ふりがなは個別設定）
  const CHAR_GAP = 28;   // 本文（before/after）用の縦ピッチ
  const BOX = 104;       // 解答マス（ご指定の大型設定）
  const BOX_GAP = 8;     // マス間
  const AFTER_GAP = 12;  // マス後の余白
  const NUM_R = 13;      // 丸数字の半径
  const AFTER_NUM_PADDING = 6; // 丸数字直後の余白

  const items = questions.slice(0, 20);

  items.forEach((q, i) => {
    const row = i < 10 ? 0 : 1;                 // 上段/下段
    const colFromRight = i % 10;                // 右から0..9
    const anchorX = PAD_X + W - (colFromRight + 0.5) * COL_W;

    // 段の上端
    const rowTop = (row === 0) ? (PAD_Y + ROW_GAP_TOP) : (MID_Y + ROW_GAP_TOP);

    // ① 丸数字は段外で描画（欠け防止）
    const numCenterY = rowTop + NUM_R + 2;
    drawNumberCircle({ n: i + 1, x: anchorX, y: numCenterY, r: NUM_R });

    // 以降は段内のみクリップ
    ctx.save();
    ctx.beginPath();
    ctx.rect(PAD_X, rowTop, W, ROW_HEIGHT);
    ctx.clip();

    const full   = String(q.fullText || "");
    const target = String(q.targetKanji || "");
    const kana   = String(q.yomigana || "");

    // target で本文分割
    let before = "", after = full;
    const idx = target ? full.indexOf(target) : -1;
    if (idx >= 0) {
      before = full.slice(0, idx);
      after  = full.slice(idx + target.length);
    }

    // ② 本文（before）※本文のみ詰める
    let cursorY = numCenterY + NUM_R + AFTER_NUM_PADDING;
    if (before) {
      drawVerticalText({ text: before, x: anchorX, y: cursorY, lineH: CHAR_GAP });
      cursorY += before.length * CHAR_GAP + 4;
    }

    // ③ マス＋ふりがな（右側固定、ふりがなは大きめ）
    if (target) {
      const totalH = target.length * (BOX + BOX_GAP) - BOX_GAP;
      ctx.save();
      ctx.strokeStyle = "#111"; ctx.lineWidth = 2;
      ctx.strokeRect(anchorX - BOX/2, cursorY, BOX, totalH);
      for (let j = 1; j < target.length; j++) {
        const yy = cursorY + j * (BOX + BOX_GAP) - BOX_GAP/2;
        ctx.beginPath();
        ctx.moveTo(anchorX - BOX/2, yy);
        ctx.lineTo(anchorX + BOX/2, yy);
        ctx.stroke();
      }
      ctx.restore();

      // ふりがな（右側・大きめ）
      if (kana) {
        drawVerticalText({
          text: kana,
          x: anchorX + BOX/2 + 30,
          y: cursorY + 10,
          lineH: 26,
          font: "18px serif"
        });
      }

      cursorY += totalH + AFTER_GAP;
    }

    // ④ 本文（after）※本文のみ詰める
    if (after) {
      drawVerticalText({ text: after, x: anchorX, y: cursorY, lineH: CHAR_GAP });
    }

    ctx.restore(); // クリップ解除
  });

  // 右下フッター：読み込んだファイル名を大きめ太字（スキャン/OCR向け）
  ctx.save();
  ctx.font = "600 24px system-ui, sans-serif"; // 太め・大きめ
  ctx.fillStyle = "#000";                      // コントラスト重視（OCR向け）
  ctx.textAlign = "right";
  ctx.textBaseline = "alphabetic";
  const footerText = __sourceFilename && __sourceFilename.trim()
    ? __sourceFilename
    : "（ファイル未指定）";
  ctx.fillText(footerText, 1700 - 20, 1200 - 16);
  ctx.restore();
}

/* ---------------- Load / Save ---------------- */
function loadFromJSON(obj) {
  if (typeof obj !== "object" || obj === null) throw new Error("JSONがオブジェクトではありません");

  __questions = null;
  let words, cols = 2;

  if (Array.isArray(obj.questions)) {
    // 元サイト形式
    __questions = obj.questions.map(q => ({
      fullText: String(q?.fullText || ""),
      targetKanji: String(q?.targetKanji || ""),
      yomigana: String(q?.yomigana || ""),
      questionType: String(q?.questionType || "")
    }));
    __lastImportedOriginal = obj; // ラウンドトリップ保存
    // UIのテキスト欄には target だけ入れておく（編集用）
    words = __questions.map(q => q.targetKanji).filter(Boolean);
    $("#words").value = fromWordsList(words);
    $("#cols").value = String(cols);
    // 描画は questions レンダラ
    drawQuestions({ questions: __questions });
    return;
  }

  if (Array.isArray(obj.words)) {
    // 自サイト形式
    words = obj.words;
    cols = obj.cols ?? 2;
    __lastImportedOriginal = null;
    __questions = null;
    $("#words").value = fromWordsList(words);
    $("#cols").value = String(cols);
    drawWords({ words, cols });
    return;
  }

  throw new Error("対応していないJSON形式です（words または questions が必要）");
}

function currentJSON() {
  if (__lastImportedOriginal && Array.isArray(__lastImportedOriginal.questions)) {
    return __lastImportedOriginal; // 元サイト形式はそのまま返す
  }
  return {
    version: 1,
    words: toWordsList($("#words").value),
    cols: parseInt($("#cols").value, 10) || 2
  };
}

function exportToJSON() {
  const json = JSON.stringify(currentJSON(), null, 2);
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "kanji-test.json";
  a.click();
  URL.revokeObjectURL(url);
}

/*  File I/O  */
function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("ファイル読み込みに失敗しました"));
    reader.onload = () => resolve(String(reader.result));
    reader.readAsText(file, "utf-8");
  });
}
async function handleJSONFile(file) {
  try {
    const text = await readFileAsText(file);
    const obj = JSON.parse(text);
    setSourceFilename(file?.name || "");   // ★ 追加：フッター用にファイル名を保持
    loadFromJSON(obj);
    alert("JSONを読み込みました");
  } catch (e) {
    console.error(e);
    alert("JSON読込エラー: " + e.message);
  }
}

/* ---------------- UI wiring ---------------- */
function doGenerateFromUI() {
  if (__questions) {
    drawQuestions({ questions: __questions });
  } else {
    drawWords({
      words: toWordsList($("#words").value),
      cols: parseInt($("#cols").value, 10) || 2
    });
  }
}

$("#generate").addEventListener("click", doGenerateFromUI);

$("#download").addEventListener("click", () => {
  const a = document.createElement("a");
  a.href = canvas.toDataURL("image/png");
  a.download = "kanji-test.png";
  a.click();
});

$("#export-json").addEventListener("click", exportToJSON);
$("#import-json").addEventListener("click", () => $("#json-file").click());
$("#json-file").addEventListener("change", (ev) => {
  const file = ev.target.files?.[0];
  if (file) handleJSONFile(file);
  ev.target.value = "";
});

// ドロップ読み込み
const dropzone = $("#dropzone");
["dragenter", "dragover"].forEach((t) =>
  dropzone.addEventListener(t, (e) => { e.preventDefault(); e.stopPropagation(); dropzone.style.outline = "2px dashed #999"; })
);
["dragleave", "drop"].forEach((t) =>
  dropzone.addEventListener(t, (e) => { e.preventDefault(); e.stopPropagation(); dropzone.style.outline = "none"; })
);
dropzone.addEventListener("drop", (e) => {
  const file = e.dataTransfer?.files?.[0];
  if (file && file.type === "application/json") handleJSONFile(file);
  else if (file) alert("JSONファイルをドロップしてください");
});

/* ---------------- Initial render ---------------- */
setupCanvasForDPR(); // ← これを必ず最初に呼ぶ
const { words, cols, auto } = parseParams();
// パラメータだけで来たときは words 描画
drawWords({ words, cols });
if (auto === "1") {
  $("#words").value = fromWordsList(words);
  $("#cols").value = String(cols);
}

// postMessage で外部から生成命令（外部からファイル名を渡せるように）
window.addEventListener("message", (ev) => {
  if (ev?.data?.type === "GENERATE") {
    const payload = ev.data.payload || {};
    if (typeof payload.filename === "string") {
      setSourceFilename(payload.filename); // ★ 追加
    }
    if (Array.isArray(payload.questions)) {
      loadFromJSON({ questions: payload.questions });
    } else {
      const w = Array.isArray(payload.words) ? payload.words : toWordsList((payload.words || "").toString());
      const c = payload.cols || 2;
      loadFromJSON({ words: w, cols: c });
    }
  }
});
