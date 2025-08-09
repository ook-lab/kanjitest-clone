const $ = (s) => document.querySelector(s);
const canvas = $("#preview");
const ctx = canvas.getContext("2d");

// 直近に読み込んだオリジナルJSON（ラウンドトリップ用）
let __lastImportedOriginal = null;

/** -------------------------
 *  ユーティリティ
 * ------------------------- */
function toWordsList(raw) {
  return raw
    .split(/[\n,]/)
    .map(s => s.trim())
    .filter(Boolean);
}

function fromWordsList(list) {
  return (list || []).join("\n");
}

function parseParams() {
  const p = new URLSearchParams(location.search);
  const wordsParam = p.get("words");
  const colsParam = p.get("cols");
  const auto = p.get("auto");
  const words = wordsParam ? toWordsList(wordsParam) : toWordsList($("#words").value);
  const cols = colsParam ? parseInt(colsParam, 10) : (parseInt($("#cols").value, 10) || 2);
  return { words, cols, auto };
}

/** -------------------------
 *  描画
 * ------------------------- */
function draw({ words, cols = 2 }) {
  // 背景
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // 余白と枠
  const padding = 80;
  const contentW = canvas.width - padding * 2;
  const contentH = canvas.height - padding * 2;
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
    const xRight = padding + colWidth * (col + 1) - 24; // 右寄せ気味
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

/** -------------------------
 *  UI操作
 * ------------------------- */
function doGenerateFromUI() {
  draw({
    words: toWordsList($("#words").value),
    cols: parseInt($("#cols").value, 10) || 2
  });
}

$("#generate").addEventListener("click", doGenerateFromUI);

$("#download").addEventListener("click", () => {
  const a = document.createElement("a");
  a.href = canvas.toDataURL("image/png");
  a.download = "kanji-test.png";
  a.click();
});

/** -------------------------
 *  JSON 読み込み / 保存
 * ------------------------- */

/** JSON→UI反映→描画（両形式対応） */
function loadFromJSON(obj) {
  if (typeof obj !== "object" || obj === null) throw new Error("JSONがオブジェクトではありません");

  let words, cols = 2;

  if (Array.isArray(obj.words)) {
    // 自サイト形式
    words = obj.words;
    cols = obj.cols ?? 2;
    __lastImportedOriginal = null; // 自サイト形式の場合は保持しない
  } else if (Array.isArray(obj.questions)) {
    // 元サイト形式
    words = obj.questions.map(q => q?.targetKanji || "").filter(Boolean);
    cols = Number.isInteger(obj.cols) ? obj.cols : (parseInt($("#cols").value, 10) || 2);
    __lastImportedOriginal = obj; // オリジナルを保持（保存時に元形式で出せる）
  } else {
    throw new Error("対応していないJSON形式です（words または questions が必要）");
  }

  if (!Array.isArray(words) || words.some(w => typeof w !== "string" || !w)) {
    throw new Error("語彙の抽出に失敗しました");
  }

  $("#words").value = words.join("\n");
  $("#cols").value = String(cols);
  draw({ words, cols });
}

/** 現在のUI状態をJSON化（読み込んだ形式を優先） */
function currentJSON() {
  if (__lastImportedOriginal && Array.isArray(__lastImportedOriginal.questions)) {
    return __lastImportedOriginal; // 元サイト形式で読み込んだ場合はそのまま返す
  }
  return {
    version: 1,
    words: toWordsList($("#words").value),
    cols: parseInt($("#cols").value, 10) || 2
  };
}

/** JSONダウンロード */
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

/** ファイル→テキスト */
function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("ファイル読み込みに失敗しました"));
    reader.onload = () => resolve(String(reader.result));
    reader.readAsText(file, "utf-8");
  });
}

/** JSONファイルを処理 */
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

/** ボタン：JSON保存 */
$("#export-json").addEventListener("click", exportToJSON);

/** ボタン：JSON読込（ファイル選択） */
$("#import-json").addEventListener("click", () => $("#json-file").click());
$("#json-file").addEventListener("change", (ev) => {
  const file = ev.target.files?.[0];
  if (file) handleJSONFile(file);
  ev.target.value = "";
});

/** ドラッグ＆ドロップ読み込み */
const dropzone = $("#dropzone");
["dragenter", "dragover"].forEach((type) =>
  dropzone.addEventListener(type, (e) => {
    e.preventDefault();
    e.stopPropagation();
    dropzone.style.outline = "2px dashed #999";
  })
);
["dragleave", "drop"].forEach((type) =>
  dropzone.addEventListener(type, (e) => {
    e.preventDefault();
    e.stopPropagation();
    dropzone.style.outline = "none";
  })
);
dropzone.addEventListener("drop", (e) => {
  const file = e.dataTransfer?.files?.[0];
  if (file && file.type === "application/json") {
    handleJSONFile(file);
  } else if (file) {
    alert("JSONファイルをドロップしてください");
  }
});

/** -------------------------
 *  初期描画（URLパラメータ優先）
 * ------------------------- */
const { words, cols, auto } = parseParams();
draw({ words, cols });
if (auto === "1") {
  $("#words").value = fromWordsList(words);
  $("#cols").value = String(cols);
}

// postMessage で外部から生成命令
window.addEventListener("message", (ev) => {
  if (ev?.data?.type === "GENERATE") {
    const payload = ev.data.payload || {};
    const w = Array.isArray(payload.words) ? payload.words : toWordsList((payload.words || "").toString());
    const c = payload.cols || 2;
    loadFromJSON({ words: w, cols: c });
  }
});
