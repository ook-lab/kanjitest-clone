// /functions/api/upload.js
// Cloudflare Pages Functions → Google Drive へ dataURL 画像を保存
export const onRequestPost = async ({ request, env }) => {
  try {
    const { filename, dataUrl, mimeType = "image/png" } = await request.json();

    if (!filename || !dataUrl?.startsWith("data:")) {
      return json({ ok: false, error: "invalid payload" }, 400);
    }
    if (!env.GOOGLE_CREDENTIALS || !env.DRIVE_FOLDER_ID) {
      return json({ ok: false, error: "missing env vars" }, 500);
    }

    // 1) サービスアカウントで JWT → アクセストークン
    const creds = JSON.parse(env.GOOGLE_CREDENTIALS);
    const now = Math.floor(Date.now() / 1000);
    const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
    const claim = b64url(JSON.stringify({
      iss: creds.client_email,
      scope: "https://www.googleapis.com/auth/drive.file",
      aud: "https://oauth2.googleapis.com/token",
      exp: now + 3600,
      iat: now
    }));
    const toSign = new TextEncoder().encode(`${header}.${claim}`);
    const key = await crypto.subtle.importKey(
      "pkcs8",
      pemToPkcs8(creds.private_key),
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["sign"]
    );
    const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, toSign);
    const jwt = `${header}.${claim}.${b64url(ab2b64(sig))}`;

    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion: jwt
      })
    });
    if (!tokenRes.ok) {
      return json({ ok: false, error: "token error", detail: await tokenRes.text() }, 500);
    }
    const { access_token } = await tokenRes.json();

    // 2) dataURL → バイナリ
    const comma = dataUrl.indexOf(",");
    const meta = dataUrl.slice(5, comma); // e.g. "image/png;base64"
    const mime = mimeType || meta.split(";")[0] || "application/octet-stream";
    const b64 = dataUrl.slice(comma + 1);
    const fileBytes = b64ToBytes(b64);

    // 3) Drive multipart/related アップロード
    const metaPart = JSON.stringify({ name: filename, parents: [env.DRIVE_FOLDER_ID] });
    const boundary = "xxxxx" + Math.random().toString(16).slice(2);
    const body = buildMultipart(boundary, metaPart, mime, fileBytes);

    const up = await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${access_token}`,
        "Content-Type": `multipart/related; boundary=${boundary}`
      },
      body
    });
    const text = await up.text();
    if (!up.ok) return json({ ok: false, error: "Drive upload failed", detail: text }, 500);

    const data = JSON.parse(text);
    return json({ ok: true, id: data.id, webViewLink: data.webViewLink });
  } catch (e) {
    return json({ ok: false, error: String(e?.message || e) }, 500);
  }
};

/* helpers */
const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json" } });

const b64url = (str) => btoa(str).replace(/=+/g, "").replace(/\+/g, "-").replace(/\//g, "_");

function ab2b64(buf) {
  let s = "";
  const v = new Uint8Array(buf);
  for (let i = 0; i < v.length; i++) s += String.fromCharCode(v[i]);
  return btoa(s);
}
function b64ToBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function pemToPkcs8(pem) {
  const b64 = pem.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
}
function buildMultipart(boundary, metadataJson, mime, fileBytes) {
  const enc = new TextEncoder();
  const p1 = enc.encode(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadataJson}\r\n`);
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
