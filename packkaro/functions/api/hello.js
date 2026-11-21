export async function onRequestGet() {
  return new Response(
    JSON.stringify({ ok: true, message: "Hello from the Cloudflare server!" }),
    { headers: { "Content-Type": "application/json" } }
  );
}
