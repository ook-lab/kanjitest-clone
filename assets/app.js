const $ = (s) => document.querySelector(s);
const canvas = $("#preview");
const ctx = canvas.getContext("2d");

function toWordsList(raw) {
  return raw
    .split(/[\n,]/)
    .map(s => s.trim())
    .filter(Boolean);
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

function draw({ words, cols = 2 }) {
  // 背景
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // 見出し・余白設定
  const padding = 80;
  const contentW = canvas.width - padding * 2;
  const contentH = canvas.height - padding * 2;

  // 罫線薄く
  ctx.strokeStyle = "#e5e5e5";
  ctx.lineWidth = 1;
  ctx.strokeRect(padding, padding, contentW, contentH);

  // 文字設定
  ctx.fillStyle = "#000";
  ctx.font = "32px serif";

  // 縦レイアウト：列×行（簡易）
  const colWidth = Math.floor(contentW / cols);
  const lineGap = 64;

  words.forEach((w, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const xRight = padding + colWidth * (col + 1) - 24; // 右寄せ気味
    const yTop = padding + 64 + row * lineGap;

    // 一文字ずつ縦に描く
    const step = 34;
    for (let k = 0; k < w.length; k++) {
      const ch = w[k];
      const x = xRight - (step * k);
      const y = yTop;
      ctx.fillText(ch, x, y);
    }

    // マス枠（語全体）
    const width = step * w.length + 24;
    ctx.strokeStyle = "#ddd";
    ctx.strokeRect(xRight - width + 12, yTop - 40, width, 48);
  });
}

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

// URLパラメータで自動生成：?words=犬,猫,鳥&cols=3&auto=1
const { words, cols, auto } = parseParams();
draw({ words, cols });
if (auto === "1") {
  // UIへも反映しておく
  $("#words").value = words.join("\n");
  $("#cols").value = String(cols);
}

// 外部からのpostMessageで生成命令
window.addEventListener("message", (ev) => {
  if (ev?.data?.type === "GENERATE") {
    const payload = ev.data.payload || {};
    draw({
      words: toWordsList((payload.words || []).join("\n")),
      cols: payload.cols || 2
    });
  }
});
