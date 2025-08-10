// /functions/api/upload.js（multipart対応 v4）
// 必須ENV: GOOGLE_CREDENTIALS（SA JSON or Base64）, DRIVE_FOLDER_ID
// 任意ENV: UPLOAD_SECRET（HMAC共有鍵。設定があれば検証）

export const onRequestPost = async ({ request, env }) => {
  try {
    // 0) 署名検証（任意。FormData/JSONどちらでもrawが取れないのでfilenameで検証に変更）
    let filenameForSig = "";
    // まず FormData を試す
    let isForm = false, filename = "", mimeType = "image/png", fileBlob = null, dataUrl = "";

    try {
      const ct = request.headers.get("content-type") || "";
      if (ct.includes("multipart/form-data")) {
        const form = await request.formData();
        filename = String(form.get("filename") || "");
        mimeType = String(form.get("mimeType") || "image/png");
        fileBlob = form.get("file");
        if (!(fileBlob instanceof Blob)) throw new Error("no file");
        isForm = true;
      }
    } catch { /* ここでは黙ってJSONにフォールバック */ }

    if (!isForm) {
      // JSONフォールバック
      const raw = await request.text();
      let payload;
      try {
        payload = JSON.parse(raw);
      } catch (e) {
        return j({ ok:false, error:"bad json", detail:String(e?.message||e) }, 400);
      }
      filename = String(payload?.filename || "");
      mimeType = String(payload?.mimeType || "image/png");
      dataUrl  = String(payload?.dataUrl || "");
      if (!dataUrl.startsWith("data:") || !dataUrl.includes(",")) {
        return j({ ok:false, error:"invalid dataUrl" }, 400);
      }
    }

    // 署名検証（UPLOAD_SECRETがある時だけ）
    if (env.UPLOAD_SECRET) {
      const sig = request.headers.get("x-signature") || "";
      filenameForSig = filename || "";
      const ok = await verifyHmac(filenameForSig, sig, env.UPLOAD_SECRET);
      if (!ok) return j({ ok:false, error:"unauthorized" }, 401);
    }

    if (!filename) return j({ ok:false, error:"filename required" }, 400);
    if (!env.GOOGLE_CREDENTIALS || !env.DRIVE_FOLDER_ID) {
      return j({ ok:false, error:"missing env vars (GOOGLE_CREDENTIALS / DRIVE_FOLDER_ID)" }, 500);
    }

    const creds = loadServiceAccount(env.GOOGLE_CREDENTIALS);
    const accessToken = await getAccessToken(creds);
    if (!accessToken) return j({ ok:false, error:"failed to get access token" }, 500);

    // 1) バイナリ取得
    let finalMime = mimeType || "application/octet-stream";
    let fileBytes;
    if (isForm) {
      finalMime = fileBlob.type || finalMime;
      fileBytes = new Uint8Array(await fileBlob.arrayBuffer());
    } else {
      const comma = dataUrl.indexOf(",");
      const meta = dataUrl.slice(5, comma); // e.g. "image/png;base64"
      const inferredMime = (meta.split(";")[0] || "").trim();
      finalMime = finalMime || inferredMime || "application/octet-stream";
      const b64 = dataUrl.slice(comma + 1);
      fileBytes = b64ToBytes(b64);
    }

    // 2) Drive multipart/related アップロード
    const safeName = sanitizeName(filename);
    const metadata = JSON.stringify({ name: safeName, parents: [env.DRIVE_FOLDER_ID] });
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
    if (!upRes.ok) return j({ ok:false, error:"Drive upload failed", detail: upText }, 500);
    const data = JSON.parse(upText);

    return j({ ok:true, id:data.id, name:data.name, webViewLink:data.webViewLink||null, webContentLink:data.webContentLink||null });
  } catch (e) {
    return j({ ok:false, error:String(e?.message||e) }, 500);
  }
};

// 疎通確認（GET）
export const onRequestGet = async () =>
  new Response(JSON.stringify({ status:"ok", version:"v4-multipart" }), {
    status: 200,
    headers: { "Content-Type": "application/json" }
  });

/* ===== helpers ===== */

const j = (obj, status=200) =>
  new Response(JSON.stringify(obj), { status, headers: { "Content-Type":"application/json" } });

// HMAC（filenameベース）
async function verifyHmac(message, b64sig, secret) {
  try {
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name:"HMAC", hash:"SHA-256" }, false, ["verify"]);
    const sigBytes = base64ToBytes(b64sig || "");
    return await crypto.subtle.verify("HMAC", key, sigBytes, enc.encode(String(message||"")));
  } catch { return false; }
}

function sanitizeName(name) {
  return String(name || "unnamed").replace(/[\\/:*?"<>|]/g, "_").slice(0, 200);
}

// SA読み込み（JSON or Base64）
function loadServiceAccount(src) {
  let text = String(src);
  // try JSON
  try {
    const obj = JSON.parse(text);
    if (obj.private_key) obj.private_key = String(obj.private_key).replace(/\\n/g, "\n");
    return obj;
  } catch {}
  // try Base64(JSON)
  try {
    const obj = JSON.parse(atob(text.replace(/\s+/g, "")));
    if (obj.private_key) obj.private_key = String(obj.private_key).replace(/\\n/g, "\n");
    return obj;
  } catch {}
  throw new Error("GOOGLE_CREDENTIALS must be raw JSON or its Base64");
}

// Google OAuth (SA JWT)
async function getAccessToken(creds) {
  const now = Math.floor(Date.now()/1000);
  const header = base64url(JSON.stringify({ alg:"RS256", typ:"JWT" }));
  const claim  = base64url(JSON.stringify({
    iss: creds.client_email,
    scope: "https://www.googleapis.com/auth/drive.file",
    aud: "https://oauth2.googleapis.com/token",
    exp: now + 3600,
    iat: now
  }));
  const toSign = new TextEncoder().encode(`${header}.${claim}`);

  const keyBuf = pemToPkcs8(creds.private_key);
  const key = await crypto.subtle.importKey("pkcs8", keyBuf, { name:"RSASSA-PKCS1-v1_5", hash:"SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, toSign);
  const jwt = `${header}.${claim}.${base64urlBytes(sig)}`;

  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method:"POST",
    headers:{ "Content-Type":"application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type:"urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: jwt })
  });
  const text = await tokenRes.text();
  if (!tokenRes.ok) return null;
  return (JSON.parse(text).access_token) || null;
}

// base64/data utils
function b64ToBytes(b64) { const bin = atob(b64); const out = new Uint8Array(bin.length); for (let i=0;i<bin.length;i++) out[i]=bin.charCodeAt(i); return out; }
function base64ToBytes(b64){ b64=String(b64||"").replace(/\s+/g,""); return b64ToBytes(b64); }
function bytesToBase64(buf){ const v=new Uint8Array(buf); let s=""; for(let i=0;i<v.length;i++) s+=String.fromCharCode(v[i]); return btoa(s); }
function base64url(str){ return btoa(str).replace(/=+/g,"").replace(/\+/g,"-").replace(/\//g,"_"); }
function base64urlBytes(buf){ return bytesToBase64(buf).replace(/=+/g,"").replace(/\+/g,"-").replace(/\//g,"_"); }
function pemToPkcs8(pem){ const b64=String(pem||"").replace(/-----[^-]+-----/g,"").replace(/\s+/g,""); return b64ToBytes(b64).buffer; }

// multipart builder
function buildMultipart(boundary, metadataJson, mime, fileBytes) {
  const enc = new TextEncoder();
  const p1 = enc.encode(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadataJson}\r\n`);
  const p2 = enc.encode(`--${boundary}\r\nContent-Type: ${mime}\r\n\r\n`);
  const p3 = fileBytes;
  const p4 = enc.encode(`\r\n--${boundary}--`);
  const out = new Uint8Array(p1.length + p2.length + p3.length + p4.length);
  out.set(p1, 0); out.set(p2, p1.length); out.set(p3, p1.length+p2.length); out.set(p4, p1.length+p2.length+p3.length);
  return out;
}
