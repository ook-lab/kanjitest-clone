// /functions/api/upload.js — GASへJSONで中継（安定版・全文）
// ENV: GAS_WEBAPP_URL (/exec), UPLOAD_SECRET（GASと同じ）

export const onRequestPost = async ({ request, env }) => {
  try {
    const gasUrl = env.GAS_WEBAPP_URL;
    const secret = env.UPLOAD_SECRET;
    if (!gasUrl || !secret) return j({ ok:false, error:"missing env GAS_WEBAPP_URL / UPLOAD_SECRET" }, 500);

    // 1) クライアントから受け取る（multipart or JSON の両対応）
    let filename = "", mimeType = "image/png", blob = null;

    const ct = (request.headers.get("content-type") || "").toLowerCase();
    if (ct.includes("multipart/form-data")) {
      const form = await request.formData();
      filename = String(form.get("filename") || "");
      mimeType = String(form.get("mimeType") || "image/png");
      const f = form.get("file");
      if (!(f instanceof Blob)) return j({ ok:false, error:"no file" }, 400);
      blob = f;
    } else {
      const raw = await request.text();
      let payload;
      try { payload = JSON.parse(raw); }
      catch (e) { return j({ ok:false, error:"bad json", detail:String(e?.message||e) }, 400); }
      filename = String(payload?.filename || "");
      mimeType = String(payload?.mimeType || "image/png");
      const dataUrl = String(payload?.dataUrl || "");
      if (!dataUrl.startsWith("data:") || !dataUrl.includes(",")) return j({ ok:false, error:"invalid dataUrl" }, 400);
      const resp = await fetch(dataUrl);
      blob = await resp.blob();
    }

    if (!filename) return j({ ok:false, error:"filename required" }, 400);

    // 2) Blob -> dataURL(base64) 化（GASへはJSONで送る）
    const arrayBuf = await blob.arrayBuffer();
    const b64 = bytesToBase64(new Uint8Array(arrayBuf));
    const dataUrlOut = `data:${mimeType};base64,${b64}`;

    // 3) 署名（filename をメッセージに HMAC-SHA256 → base64）
    const signature = await hmacBase64(filename, secret);

    // 4) GASへJSON POST
    const gasRes = await fetch(gasUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ filename, mimeType, dataUrl: dataUrlOut, signature })
    });

    const text = await gasRes.text();
    if (!gasRes.ok) return j({ ok:false, error:"GAS error", detail:text }, 502);

    return new Response(text, { status: 200, headers: { "Content-Type":"application/json" } });
  } catch (e) {
    return j({ ok:false, error:String(e?.message||e) }, 500);
  }
};

// 疎通確認（GET）
export const onRequestGet = async () =>
  new Response(JSON.stringify({ status:"ok", via:"cf-proxy", target:"gas-json" }), {
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
function bytesToBase64(u8) {
  let s = ""; for (let i=0;i<u8.length;i++) s += String.fromCharCode(u8[i]);
  return btoa(s);
}
