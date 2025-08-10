// /functions/api/upload.js  — Cloudflare Pages Functions → GAS Webアプリ中継（全文）
//
// 必須ENV:
//   GAS_WEBAPP_URL  … GASの /exec URL
//   UPLOAD_SECRET   … GAS側と共有のシークレット（HMAC用）
//
// 受け口: フロントからは multipart/form-data 推奨（filename, mimeType, file）
//         JSON { filename, mimeType, dataUrl } もフォールバック対応（dataUrl→Blob化）
// セキュリティ: filename をメッセージに base64(HMAC-SHA256) を作成し、FormDataの "signature" としてGASへ送信。

export const onRequestPost = async ({ request, env }) => {
  try {
    const gasUrl = env.GAS_WEBAPP_URL;
    const secret = env.UPLOAD_SECRET;
    if (!gasUrl || !secret) {
      return j({ ok:false, error:"missing env GAS_WEBAPP_URL / UPLOAD_SECRET" }, 500);
    }

    let filename = "", mimeType = "image/png", fileBlob = null;

    const ct = (request.headers.get("content-type") || "").toLowerCase();
    if (ct.includes("multipart/form-data")) {
      // ---- multipart 受信 ----
      const form = await request.formData();
      filename = String(form.get("filename") || "");
      mimeType = String(form.get("mimeType") || "image/png");
      const f = form.get("file");
      if (!(f instanceof Blob)) return j({ ok:false, error:"no file" }, 400);
      fileBlob = f;
    } else {
      // ---- JSON フォールバック ----
      const raw = await request.text();
      let payload;
      try { payload = JSON.parse(raw); }
      catch (e) { return j({ ok:false, error:"bad json", detail:String(e?.message||e) }, 400); }
      filename = String(payload?.filename || "");
      mimeType = String(payload?.mimeType || "image/png");
      const dataUrl = String(payload?.dataUrl || "");
      if (!dataUrl.startsWith("data:") || !dataUrl.includes(",")) {
        return j({ ok:false, error:"invalid dataUrl" }, 400);
      }
      const resp = await fetch(dataUrl);
      fileBlob = await resp.blob();
    }

    if (!filename) return j({ ok:false, error:"filename required" }, 400);

    // ---- HMAC 生成（filename をメッセージ）----
    const signature = await hmacBase64(filename, secret);

    // ---- GASへ中継（multipartで新規作成）----
    const fd = new FormData();
    fd.append("filename", filename);
    fd.append("mimeType", mimeType);
    fd.append("signature", signature); // ← GAS側で検証
    fd.append("file", new File([fileBlob], filename, { type: mimeType }));

    const gasRes = await fetch(gasUrl, { method: "POST", body: fd });
    const text = await gasRes.text();
    if (!gasRes.ok) return j({ ok:false, error:"GAS error", detail:text }, 502);

    // GASのJSONをそのまま返却
    return new Response(text, { status: 200, headers: { "Content-Type": "application/json" } });
  } catch (e) {
    return j({ ok:false, error:String(e?.message||e) }, 500);
  }
};

// 疎通確認（GET）
export const onRequestGet = async () =>
  new Response(JSON.stringify({ status:"ok", via:"cf-proxy", target:"gas" }), {
    status: 200, headers: { "Content-Type":"application/json" }
  });

/* helpers */
const j = (obj, status=200) =>
  new Response(JSON.stringify(obj), { status, headers:{ "Content-Type":"application/json" } });

async function hmacBase64(message, secret) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name:"HMAC", hash:"SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(String(message||"")));
  const b = new Uint8Array(sig);
  let s = ""; for (let i=0;i<b.length;i++) s += String.fromCharCode(b[i]);
  return btoa(s);
}
