// Cloudflare Pages Function.
// Any file inside /functions becomes a server URL automatically:
//   functions/api/hello.js  ->  https://your-site.pages.dev/api/hello
//
// Later we will add files like:
//   functions/api/send-otp.js, verify-otp.js, create-qr.js, payment-webhook.js

export async function onRequestGet() {
  return new Response(
    JSON.stringify({
      ok: true,
      message: "Hello from the Cloudflare server!",
      time: new Date().toISOString()
    }),
    { headers: { "Content-Type": "application/json" } }
  );
}
