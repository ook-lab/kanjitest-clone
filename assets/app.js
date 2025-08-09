const $ = (s) => document.querySelector(s);
const canvas = $("#preview");
const ctx = canvas.getContext("2d");

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

/* 文字を縦に並べて描画 */
function drawVerticalText({ text, x, y, lineH = 36, font = "32px serif" }) {
  ctx.save();
  ctx.font = font;
  ctx.fillStyle = "#000";
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    ctx.fillText(ch, x, y + i * lineH);
  }
  ctx.restore();
}

/* 番号の丸 */
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

/* 縦に並んだマス（targetKanji の文字数ぶん）とフリガナ */
function drawKanjiBoxesWithFurigana({ x, y, count, box = 40, gap = 4, yomigana = "" }) {
  ctx.save();
  ctx.strokeStyle = "#111";
  ctx.lineWidth = 2;

  // 外枠（縦長の長方形）
  const totalH = count * (box + gap) - gap;
  ctx.strokeRect(x, y, box, totalH);

  // 仕切り線
  for (let i = 1; i < count; i++) {
    const yy = y + i * (box + gap) - gap/2;
    ctx.beginPath();
    ctx.moveTo(x, yy);
    ctx.lineTo(x + box, yy);
    ctx.stroke();
  }

  // フリガナ（箱の左側に縦書きで）
  if (yomigana) {
    drawVerticalText({
      text: yomigana,
      x: x - 26,
      y: y + 24,
      lineH: 20,
      font: "14px serif"
    });
  }
  ctx.restore();
}

/* ---------------- Drawing ---------------- */

/* A) words 形式（簡易レイアウト：従来） */
function drawWords({ words, cols = 2 }) {
  // 背景
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const padding = 80;
  const contentW = canvas.width - padding * 2;
  const contentH = canvas.height - padding * 2;

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

    // 縦：一文字ずつ
    const step = 34;
    for (let k = 0; k < w.length; k++) {
      const ch = w[k];
      const x = xRight - (step * k);
      const y = yTop;
      ctx.fillText(ch, x, y);
    }

    // マス枠
    const width = step * w.length + 24;
    ctx.strokeStyle = "#ddd";
    ctx.strokeRect(xRight - width + 12, yTop - 40, width, 48);
  });
}

/* B) questions 形式：番号・フリガナ・空欄・縦書き文（2段×10問） */
function drawQuestions({ questions }) {
  // 背景
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const paddingX = 60;
  const paddingY = 60;
  const contentW = canvas.width - paddingX * 2;
  const contentH = canvas.height - paddingY * 2;

  // セパレータ（中央）
  ctx.strokeStyle = "#999";
  ctx.lineWidth = 1;
  const midY = paddingY + contentH / 2;
  ctx.beginPath();
  ctx.moveTo(paddingX, midY);
  ctx.lineTo(paddingX + contentW, midY);
  ctx.stroke();

  // 2段×10列。右→左に並べる（紙面の雰囲気寄せ）
  const cols = 10;
  const colW = contentW / cols;
  const topRowY = paddingY + 20;
  const bottomRowY = midY + 20;

  const charGap = 36;          // 文字の縦ピッチ
  const boxSize = 42;          // マスの一辺
  const boxGap = 6;            // マスとマスの隙間
  const afterTextGap = 14;     // 箱の後の文章の余白

  questions.slice(0, 20).forEach((q, i) => {
    const row = i < 10 ? 0 : 1;
    const col = i % 10;
    const xAnchor = paddingX + contentW - (col + 0.5) * colW; // 右詰め寄り
    const startY = row === 0 ? topRowY : bottomRowY;

    // ① 番号（上側に）
    drawNumberCircle({ n: i + 1, x: xAnchor, y: startY - 10, r: 14 });

    // ② 文を targetKanji で分割
    const full = String(q.fullText || "");
    const target = String(q.targetKanji || "");
    const kana = String(q.yomigana || "");
    let before = "", after = full;
    if (target && full.includes(target)) {
      const parts = full.split(target);
      before = parts[0] || "";
      after  = (parts[1] || "");
    }

    // ③ 縦書きで before
    let cursorY = startY + 12;
    if (before) {
      drawVerticalText({ text: before, x: xAnchor, y: cursorY, lineH: charGap });
      cursorY += before.length * charGap + 8;
    }

    // ④ 空欄（targetKanji の文字数分）＋フリガナ
    if (target) {
      drawKanjiBoxesWithFurigana({
        x: xAnchor - boxSize / 2,
        y: cursorY,
        count: target.length,
        box: boxSize,
        gap: boxGap,
        yomigana: kana
      });
      cursorY += target.length * (boxSize + boxGap) - boxGap + afterTextGap;
    }

    // ⑤ 縦書きで after
    if (after) {
      drawVerticalText({ text: after, x: xAnchor, y: cursorY, lineH: charGap });
    }
  });

  // 右下にクレジットっぽい表示（雰囲気）
  ctx.save();
  ctx.font = "14px system-ui, sans-serif";
  ctx.fillStyle = "#777";
  ctx.textAlign = "right";
  ctx.fillText("漢字テストメーカー", canvas.width - 20, canvas.height - 16);
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
const { words, cols, auto } = parseParams();
// パラメータだけで来たときは words 描画
drawWords({ words, cols });
if (auto === "1") {
  $("#words").value = fromWordsList(words);
  $("#cols").value = String(cols);
}

// postMessage で外部から生成命令
window.addEventListener("message", (ev) => {
  if (ev?.data?.type === "GENERATE") {
    const payload = ev.data.payload || {};
    if (Array.isArray(payload.questions)) {
      loadFromJSON({ questions: payload.questions });
    } else {
      const w = Array.isArray(payload.words) ? payload.words : toWordsList((payload.words || "").toString());
      const c = payload.cols || 2;
      loadFromJSON({ words: w, cols: c });
    }
  }
});
