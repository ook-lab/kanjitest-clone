// /functions/api/upload.js（全文差し替え・HMAC署名検証版）
// Cloudflare Pages Functions → Google Drive へ dataURL(PNG/JPEG等) を保存
// 必須ENV: GOOGLE_CREDENTIALS（SA JSON文字列）, DRIVE_FOLDER_ID（保存先フォルダID）
// 任意ENV: UPLOAD_SECRET（HMAC共有鍵。設定時は X-Signature 検証を実施）

export const onRequestPost = async ({ request, env }) => {
  try {
    // 0) RAW受信（ログは先頭1KBのみ）
    const raw = await request.text();
    console.log("=== /api/upload RAW HEAD ===");
    console.log(raw.slice(0, 1024));
    console.log("=== /api/upload RAW END ===");

    // 0.1) 署名検証（任意）
    const sig = request.headers.get("x-signature") || "";
    if (env.UPLOAD_SECRET) {
      const ok = await verifyHmac(raw, sig, env.UPLOAD_SECRET);
      if (!ok) return j({ ok: false, error: "unauthorized" }, 401);
    }

    // 1) JSONパース
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

    // 3) サービスアカウントJWTトークン取得
    const creds = JSON.parse(String(env.GOOGLE_CREDENTIALS).replace(/\\n/g, "\n"));
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
  new Response(JSON.stringify({ status: "ok", message: "upload.js GET is alive" }), {
    status: 200,
    headers: { "Content-Type": "application/json" }
  });

/* ================= helpers ================= */

const j = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json" } });

// ── HMAC検証（X-Signature: base64(HMAC-SHA256(raw))) ──
async function verifyHmac(raw, b64sig, secret) {
  try {
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey(
      "raw",
      enc.encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["verify"]
    );
    const sigBytes = base64ToBytes(b64sig);
    return await crypto.subtle.verify("HMAC", key, sigBytes, enc.encode(raw));
  } catch {
    return false;
  }
}

function sanitizeName(name) {
  return String(name || "unnamed").replace(/[\\/:*?"<>|]/g, "_").slice(0, 200);
}

// ── Google OAuth (SA JWT) ──
async function getAccessToken(creds) {
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = base64url(
    JSON.stringify({
      iss: creds.client_email,
      scope: "https://www.googleapis.com/auth/drive.file",
      aud: "https://oauth2.googleapis.com/token",
      exp: now + 3600,
      iat: now
    })
  );
  const toSignBytes = new TextEncoder().encode(`${header}.${claim}`);

  const keyBuf = pemToPkcs8(creds.private_key);
  const key = await crypto.subtle.importKey(
    "pkcs8",
    keyBuf,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, toSignBytes);
  const jwt = `${header}.${claim}.${base64urlBytes(sig)}`;

  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt
    })
  });
  const tokenText = await tokenRes.text();
  if (!tokenRes.ok) return null;
  const { access_token } = JSON.parse(tokenText);
  return access_token || null;
}

// ── dataURL/base64 utilities ──
function b64ToBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function base64ToBytes(b64) {
  // tolerant: ignore whitespace
  b64 = String(b64 || "").replace(/\s+/g, "");
  return b64ToBytes(b64);
}
function bytesToBase64(buf) {
  const v = new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < v.length; i++) s += String.fromCharCode(v[i]);
  return btoa(s);
}
function base64url(str) {
  const b64 = btoa(str);
  return b64.replace(/=+/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}
function base64urlBytes(buf) {
  const b64 = bytesToBase64(buf);
  return b64.replace(/=+/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}
function pemToPkcs8(pem) {
  const b64 = String(pem || "").replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
  return b64ToBytes(b64).buffer;
}

// ── multipart/related builder ──
function buildMultipart(boundary, metadataJson, mime, fileBytes) {
  const enc = new TextEncoder();
  const p1 = enc.encode(
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadataJson}\r\n`
  );
  const p2 = enc.encode(`--${boundary}\r\nContent-Type: ${mime}\r\n\r\n`);
  const p3 = fileBytes;
  const p4 = enc.encode(`\r\n--${boundary}--`);
  const out = new Uint8Array(p1.length + p2.length + p3.length + p4.length);
  out.set(p1, 0);
  out.set(p2, p1.length);
  out.set(p3, p1.length + p2.length);
  out.set(p4, p1.length + p2.length + p3.length);
  return out;
}
