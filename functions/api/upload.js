// /functions/api/upload.js（全文：CREDロバスト版 v3）
// Cloudflare Pages Functions → Google Drive へ dataURL(PNG/JPEG) を保存
// 必須ENV: GOOGLE_CREDENTIALS（SA JSON or そのBase64） , DRIVE_FOLDER_ID
// 任意ENV: UPLOAD_SECRET（HMAC共有鍵。設定時は X-Signature 検証を実施）

export const onRequestPost = async ({ request, env }) => {
  try {
    // 0) RAW受信（ログは先頭1KBのみ）
    const raw = await request.text();
    console.log("[upload] RAW HEAD:", raw.slice(0, 1024));

    // 0.1) 署名検証（任意）
    const sig = request.headers.get("x-signature") || "";
    if (env.UPLOAD_SECRET) {
      const ok = await verifyHmac(raw, sig, env.UPLOAD_SECRET);
      if (!ok) return j({ ok: false, error: "unauthorized" }, 401);
    }

    // 1) JSONパース（リクエスト）
    let payload;
    try {
      payload = JSON.parse(raw);
    } catch (e) {
      return j({ ok: false, error: "bad json", detail: String(e?.message || e) }, 400);
    }

    // 2) 入力検証
    const { filename, dataUrl, mimeType = "image/png" } = payload || {};
    if (!filename || typeof filename !== "string") {
      return j({ ok: false, error: "filename required" }, 400);
    }
    if (!dataUrl || !dataUrl.startsWith("data:") || !dataUrl.includes(",")) {
      return j({ ok: false, error: "invalid dataUrl" }, 400);
    }
    if (!env.GOOGLE_CREDENTIALS || !env.DRIVE_FOLDER_ID) {
      return j({ ok: false, error: "missing env vars (GOOGLE_CREDENTIALS / DRIVE_FOLDER_ID)" }, 500);
    }

    const safeName = sanitizeName(filename);

    // 3) サービスアカウントJWTトークン取得（ロバスト読込）
    let creds;
    try {
      creds = loadServiceAccount(env.GOOGLE_CREDENTIALS);
    } catch (e) {
      return j({ ok: false, error: "bad GOOGLE_CREDENTIALS", detail: String(e?.message || e) }, 500);
    }
    const accessToken = await getAccessToken(creds);
    if (!accessToken) {
      return j({ ok: false, error: "failed to get access token" }, 500);
    }

    // 4) dataURL → バイナリ
    const comma = dataUrl.indexOf(",");
    const meta = dataUrl.slice(5, comma); // e.g. "image/png;base64"
    const inferredMime = (meta.split(";")[0] || "").trim();
    const finalMime = mimeType || inferredMime || "application/octet-stream";
    const b64 = dataUrl.slice(comma + 1);
    const fileBytes = b64ToBytes(b64);

    // 5) Drive multipart/related アップロード
    const metadata = JSON.stringify({
      name: safeName,
      parents: [env.DRIVE_FOLDER_ID]
    });
    const boundary = "bnd_" + Math.random().toString(16).slice(2);
    const body = buildMultipart(boundary, metadata, finalMime, fileBytes);

    const upRes = await fetch(
      "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink,webContentLink",
      {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${accessToken}`,
          "Content-Type": `multipart/related; boundary=${boundary}`
        },
        body
      }
    );
    const upText = await upRes.text();
    if (!upRes.ok) {
      return j({ ok: false, error: "Drive upload failed", detail: upText }, 500);
    }
    const data = JSON.parse(upText);

    return j({
      ok: true,
      id: data.id,
      name: data.name,
      webViewLink: data.webViewLink || null,
      webContentLink: data.webContentLink || null
    });
  } catch (e) {
    return j({ ok: false, error: String(e?.message || e) }, 500);
  }
};

// 疎通確認（GET）
export const onRequestGet = async () =>
  new Response(JSON.stringify({ status: "ok", version: "v3-robust-creds" }), {
    status: 200,
    headers: { "Content-Type": "application/json" }
  });

/* ================= helpers ================= */

const j = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json" } });

// ── サービスアカウント読込（どんな貼り方でもOKにする） ──
function loadServiceAccount(src) {
  let text = String(src);

  // 1) まずは素直にJSON.parseを試す（\nエスケープ済みの一般的な形式なら通る）
  try {
    const obj = JSON.parse(text);
    if (obj && obj.private_key) obj.private_key = String(obj.private_key).replace(/\\n/g, "\n");
    return obj;
  } catch {}

  // 2) Base64として解釈 → JSON.parse
  try {
    const decoded = atob(text.replace(/\s+/g, ""));
    const obj = JSON.parse(decoded);
    if (obj && obj.private_key) obj.private_key = String(obj.private_key).replace(/\\n/g, "\n");
    return obj;
  } catch {}

  // 3) 実改行が入って壊れているケース：全体の改行を \n にエスケープしてからJSON.parse
  try {
    const repaired = text.replace(/\r?\n/g, "\\n");
    const obj = JSON.parse(repaired);
    if (obj && obj.private_key) obj.private_key = String(obj.private_key).replace(/\\n/g, "\n");
    return obj;
  } catch (e) {
    throw new Error("GOOGLE_CREDENTI_
