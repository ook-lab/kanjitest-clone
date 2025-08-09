export async function onRequestPost(context) {
  try {
    return new Response(
      JSON.stringify({ status: "ok", message: "upload.js is working" }),
      { headers: { "Content-Type": "application/json" }, status: 200 }
    );
  } catch (error) {
    return new Response(
      JSON.stringify({ status: "error", message: error.message }),
      { headers: { "Content-Type": "application/json" }, status: 500 }
    );
  }
}
