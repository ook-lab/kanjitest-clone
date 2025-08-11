// /functions/api/upload.js — x-www-form-urlencoded（payload）固定でGASへ中継

export const onRequestPost = async ({ request, env }) => {
  try {
    const gasUrl = env.GAS_WEBAPP_URL;
    const secret = env.UPLOAD_SECRET;
    if (!gasUrl || !secret) return j({ ok:false, error:"missing env GAS_WEBAPP_URL / UPLOAD_SECRET" }, 500);

    // 1) クライアントから受信（multipart or JSON 両対応）
    let filename = "", mimeType = "image/png", dataUrl = "";
    const ct = (request.headers.get("content-type") || "").toLowerCase();

    if (ct.includes("multipart/form-data")) {
      const form = await request.formData();
      filename = String(form.get("filename") || "");
      mimeType = String(form.get("mimeType") || "image/png");
      const f = form.get("file");
      if (!(f instanceof Blob)) return j({ ok:false, error:"no file" }, 400);
      dataUrl = await blobToDataURL(f, mimeType);   // ← Blob → dataURL（base64）に変換
    } else {
      // JSON 受信 { filename, mimeType, dataUrl } を想定
      const raw = await request.text();
      let payload;
      try { payload = JSON.parse(raw); }
      catch (e) { return j({ ok:false, error:"bad json", detail:String(e?.message||e) }, 400); }
      filename = String(payload?.filename || "");
      mimeType = String(payload?.mimeType || "image/png");
      dataUrl  = String(payload?.dataUrl || "");
      if (!dataUrl.startsWith("data:") || !dataUrl.includes(",")) {
        return j({ ok:false, error:"invalid dataUrl" }, 400);
      }
    }

    if (!filename) return j({ ok:false, error:"filename required" }, 400);

    // 2) 署名（filename をメッセージに HMAC-SHA256 → base64）
    const signature = await hmacBase64(filename, secret);

    // 3) GAS へ x-www-form-urlencoded で POST（payload に JSON を格納）
    const payload = {
      filename,
      mimeType,
      dataUrl,
      signature
    };
    const body = new URLSearchParams({ payload: JSON.stringify(payload) });

    const gasRes = await fetch(gasUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body
    });

    const text = await gasRes.text();
    if (!gasRes.ok) {
      return j({ ok:false, error:"GAS error", detail:text }, 502);
    }
    return new Response(text, { status: 200, headers: { "Content-Type":"application/json" } });

  } catch (e) {
    return j({ ok:false, error:String(e?.message||e) }, 500);
  }
};

export const onRequestGet = async () =>
  new Response(JSON.stringify({ status:"ok", via:"cf-proxy", target:"gas-x-www-form-urlencoded" }), {
    status: 200, headers: { "Content-Type":"application/json" }
  });

/* helpers */
const j = (obj, status=200) =>
  new Response(JSON.stringify(obj), { status, headers:{ "Content-Type":"application/json" } });

async function hmacBase64(message, secret) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name:"HMAC", hash:"SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(String(message||"")));
  return btoa(String.fromCharCode(...new Uint8Array(sig)));
}

async function blobToDataURL(blob, mime) {
  const ab = await blob.arrayBuffer();
  const b64 = base64FromArrayBuffer(ab);
  return `data:${mime || blob.type || "application/octet-stream"};base64,${b64}`;
}

function base64FromArrayBuffer(ab) {
  const bytes = new Uint8Array(ab);
  let binary = "";
  const chunk = 0x8000; // 32KB チャンクでスタック保護
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}
