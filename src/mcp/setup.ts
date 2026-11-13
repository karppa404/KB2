import { randomBytes } from "node:crypto";
import { credentialPath, credentialStatus, removeCredentials, saveCredentials } from "./credentials";

const securityHeaders = {
  "Cache-Control": "no-store",
  "Content-Security-Policy": "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
};

const page = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Connect Kalshi</title>
<style>body{font:17px system-ui;background:#101b17;color:#f4faf7;max-width:540px;margin:8vh auto;padding:24px}h1{font-size:32px}label{display:block;margin:24px 0 8px}input,select,button{font:inherit;padding:12px;box-sizing:border-box;width:100%;border:1px solid #688577;border-radius:8px}button{background:#bbf5d1;color:#14281a;margin-top:28px;cursor:pointer}p{line-height:1.6}a{color:#bbf5d1}#message{white-space:pre-wrap}</style>
<h1>Connect your Kalshi account</h1><p>Enter your API key ID and select the downloaded private key. These credentials stay on this computer in an owner-only file. The file is <strong>not encrypted</strong>. Never paste private keys into chat.</p>
<form id="setup" autocomplete="off"><label for="environment">Environment</label><select id="environment" name="environment"><option value="demo">Demo (practice funds)</option><option value="production">Production (real money)</option></select><label for="apiId">API key ID</label><input id="apiId" name="apiId" required maxlength="200" spellcheck="false" autocomplete="off"><label for="privateKey">Private key file (.pem, .key or .txt)</label><input id="privateKey" type="file" required accept=".pem,.key,.txt"><p>Use an Ed25519 or RSA key (at least 2048 bits), generated in the selected Kalshi environment.</p><button id="save" type="submit">Save credentials locally</button></form><p id="message" role="status" aria-live="polite"></p>
<script>document.getElementById('setup').addEventListener('submit',async function(event){event.preventDefault();const message=document.getElementById('message'),button=document.getElementById('save'),file=document.getElementById('privateKey').files[0];if(!file||file.size>32768){message.textContent='Select a private key file smaller than 32 KB.';return;}button.disabled=true;try{const response=await fetch(location.pathname,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({apiId:document.getElementById('apiId').value,environment:document.getElementById('environment').value,privateKeyPem:await file.text()})});const result=await response.json();message.textContent=result.message;if(response.ok){document.getElementById('setup').reset();document.getElementById('setup').hidden=true;}}catch{message.textContent='Setup connection closed. Run setup again if credentials were not saved.';}finally{button.disabled=false;}});</script></html>`;

export function startSetupServer(options: { path?: string; timeoutMs?: number; onSaved?: () => void } = {}) {
  const token = randomBytes(32).toString("hex");
  const route = `/setup/${token}`;
  let completed = false;
  const response = (body: string, status: number, type = "application/json") => new Response(body, { status, headers: { ...securityHeaders, "Content-Type": type } });
  const server = Bun.serve({
    hostname: "127.0.0.1", port: 0, maxRequestBodySize: 40_000,
    async fetch(request) {
      const url = new URL(request.url);
      const host = `127.0.0.1:${server.port}`;
      if (request.headers.get("host") !== host || url.host !== host || url.pathname !== route || url.search) return response('{"message":"Not found"}', 404);
      if (completed) return response('{"message":"Setup has finished. Close this tab."}', 410);
      if (request.method === "GET") return response(page, 200, "text/html; charset=utf-8");
      if (request.method !== "POST") return response('{"message":"Method not allowed"}', 405);
      if (request.headers.get("origin") !== `http://${host}` || request.headers.get("content-type")?.split(";")[0] !== "application/json") return response('{"message":"Forbidden"}', 403);
      const fetchSite = request.headers.get("sec-fetch-site");
      if (fetchSite && fetchSite !== "same-origin") return response('{"message":"Forbidden"}', 403);
      try {
        const body = await request.text();
        if (completed) return response('{"message":"Setup has finished. Close this tab."}', 410);
        if (body.length > 40_000) return response('{"message":"Request too large"}', 413);
        saveCredentials(JSON.parse(body), options.path);
        completed = true;
        setTimeout(() => { server.stop(); options.onSaved?.(); }, 500);
        return response('{"message":"Credentials saved. Close this tab and restart the MCP connection. Saving does not verify account access."}', 200);
      } catch { return response('{"message":"Could not save credentials. Check the API key ID, environment, PEM key format and local storage permissions."}', 400); }
    },
    error() { return response('{"message":"Setup request failed"}', 400); },
  });
  const timeout = setTimeout(() => server.stop(true), options.timeoutMs ?? 10 * 60_000);
  timeout.unref();
  return { url: `http://127.0.0.1:${server.port}${route}`, stop() { clearTimeout(timeout); server.stop(true); } };
}

export async function runSetupCli(args: string[] = []): Promise<void> {
  const command = args[0] ?? "setup";
  if (args.length > 1 || !["setup", "status", "remove"].includes(command)) throw new Error("Usage: kalshi-mcp setup | status | remove");
  if (command === "status") { console.log(JSON.stringify(credentialStatus(), null, 2)); return; }
  if (command === "remove") { console.log(removeCredentials() ? "Local credentials removed. Revoke the key in Kalshi settings to invalidate it." : "No local credentials stored."); return; }
  const server = startSetupServer();
  console.error(`Open this private, temporary URL in your browser:\n${server.url}\nCredentials are saved only to ${credentialPath()} (owner-only permissions, not encrypted).\nThe setup server expires after 10 minutes. Press Ctrl+C to cancel.`);
  const stop = () => { server.stop(); process.exit(0); };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
}

if (import.meta.main) {
  try { await runSetupCli(process.argv.slice(2)); }
  catch (error) { console.error(error instanceof Error ? error.message : "Credential setup failed"); process.exitCode = 1; }
}
