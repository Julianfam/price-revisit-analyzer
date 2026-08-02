/**
 * OAuth completion after X/Google.
 *
 * X mobile often finishes inside X's in-app browser — NOT Brave.
 * Always mint a 6-digit handoff code so the user can paste it in Brave.
 */
import { createFileRoute } from "@tanstack/react-router";
import { auth, sessionTokenFromCookies } from "@/lib/auth/server";
import { createHandoff } from "@/lib/auth/handoff.server";

function safeReturnTo(raw: string | null): string {
  if (!raw) return "/";
  if (raw.startsWith("/") && !raw.startsWith("//") && !raw.includes("://")) {
    return raw.slice(0, 512);
  }
  return "/";
}

async function handleDone(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const returnTo = safeReturnTo(url.searchParams.get("returnTo"));
  const errored = url.searchParams.has("error");

  if (errored) {
    return html(
      failPage(url.searchParams.get("error") || "sign_in_failed", returnTo),
    );
  }

  let token = sessionTokenFromCookies(request);
  let userLabel = "";

  try {
    const session = await auth.api.getSession({ headers: request.headers });
    const s = session as {
      session?: { token?: string };
      user?: { name?: string | null; email?: string | null };
    } | null;
    if (!token && s?.session?.token) token = s.session.token;
    // Prefer raw session token (no cookie signature) for bearer
    if (s?.session?.token) token = s.session.token;
    userLabel = s?.user?.name || s?.user?.email || "";
  } catch (e) {
    console.warn("[oauth/done] getSession", e);
  }

  if (!token) token = sessionTokenFromCookies(request);
  // Strip cookie signature suffix if present (token.sig)
  if (token && token.includes(".")) {
    const raw = token.split(".")[0];
    if (raw && raw.length >= 16) token = raw;
  }

  if (!token) return html(failPage("no_session", returnTo));

  const { code, expiresAt } = createHandoff(token, userLabel);
  return html(successPage(token, returnTo, code, expiresAt, userLabel));
}

function html(body: string): Response {
  return new Response(body, {
    status: 200,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

function successPage(
  token: string,
  returnTo: string,
  code: string,
  expiresAt: number,
  userLabel: string,
): string {
  const safeToken = JSON.stringify(token);
  const safeReturn = JSON.stringify(returnTo);
  const safeCode = JSON.stringify(code);
  const safeLabel = JSON.stringify(userLabel || "");
  const mins = Math.max(1, Math.round((expiresAt - Date.now()) / 60_000));
  const msg = JSON.stringify({
    source: "grok-auth-popup",
    token,
  }).replace(/</g, "\\u003c");

  return `<!doctype html>
<html lang="es"><head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"/>
<meta name="color-scheme" content="dark"/>
<title>Código de acceso</title>
<style>
html,body{margin:0;min-height:100%;background:#0b0b0c;color:#e4e4e7;
font:15px/1.5 system-ui,-apple-system,sans-serif;-webkit-text-size-adjust:100%}
main{min-height:100dvh;display:grid;place-items:center;padding:1rem;text-align:center}
.card{max-width:22rem;width:100%;background:#141416;border:1px solid #27272a;
border-radius:16px;padding:1.15rem 1rem 1.25rem;box-shadow:0 12px 40px #0008}
.ok{color:#2dd4bf;font-size:1.75rem;line-height:1;margin-bottom:.35rem}
h1{margin:0 0 .35rem;font-size:1.2rem;color:#fafafa;font-weight:700}
.sub{color:#a1a1aa;font-size:13px;margin:0 0 .75rem}
.code{
  font:800 2.15rem/1.15 ui-monospace,SFMono-Regular,Menlo,monospace;
  letter-spacing:.32em;padding:.8rem .4rem .8rem .72rem;
  background:#0b0b0c;border:2px solid #2dd4bf88;border-radius:14px;
  color:#2dd4bf;margin:.35rem 0 .9rem;user-select:all;-webkit-user-select:all
}
.steps{text-align:left;color:#d4d4d8;font-size:13px;margin:0 0 1rem;padding-left:1.15rem}
.steps li{margin:.4rem 0}
a,button{
  display:block;width:100%;box-sizing:border-box;margin:.45rem 0 0;
  background:#2dd4bf;color:#042f2e;border:0;border-radius:12px;
  padding:15px 16px;font:700 15px/1.2 inherit;text-decoration:none;cursor:pointer
}
.secondary{background:transparent;color:#2dd4bf;border:1px solid #2dd4bf55}
.hint{font-size:11px;color:#71717a;margin-top:.85rem}
.warn{background:#422006;color:#fdba74;border:1px solid #9a341288;
border-radius:12px;padding:.7rem .8rem;font-size:12.5px;text-align:left;margin-bottom:.9rem;line-height:1.45}
.who{color:#fafafa;font-weight:600;font-size:14px;margin:0 0 .5rem}
</style></head><body><main>
<div class="card">
  <div class="ok" aria-hidden="true">✓</div>
  <h1>Sesión lista</h1>
  <p class="who" id="who"></p>

  <div class="warn" id="inapp">
    <strong>X abrió su propio navegador.</strong>
    Brave no recibe la sesión solo.
    <br/>Copia el código y pégalo en la app (Login → <em>Tengo un código</em>).
  </div>

  <p class="sub" style="margin-bottom:.2rem">Tu código de 6 dígitos</p>
  <div class="code" id="code"></div>

  <ol class="steps">
    <li>Toca <strong>Copiar código</strong>.</li>
    <li>Abre <strong>Brave</strong> (o el preview de Grok).</li>
    <li>Login → <strong>Tengo un código</strong> → pega → Entrar.</li>
  </ol>

  <button type="button" id="copy">Copiar código</button>
  <a id="open" class="secondary" href="/">Abrir app aquí</a>
  <p class="hint">Válido ~${mins} min · un solo uso</p>
</div>
<script type="application/json" id="msg">${msg}</script>
<script>
(function(){
  var KEY="grok-auth.bearer-token";
  var TOKEN=${safeToken};
  var CODE=${safeCode};
  var RETURN_TO=${safeReturn};
  var LABEL=${safeLabel};
  var payload={source:"grok-auth-popup",token:TOKEN};

  try{
    var el=document.getElementById("msg");
    if(el&&el.textContent) payload=JSON.parse(el.textContent);
  }catch(e){}

  function store(t){
    if(!t) return;
    try{sessionStorage.setItem(KEY,t);}catch(e){}
    try{localStorage.setItem(KEY,t);}catch(e){}
    try{localStorage.setItem(KEY+".ping",String(Date.now()));}catch(e){}
  }

  function notify(){
    var origin=location.origin;
    try{
      if(window.opener&&!window.opener.closed){
        window.opener.postMessage(payload,origin);
        window.opener.postMessage(payload,"*");
      }
    }catch(e){}
    try{
      if(window.parent&&window.parent!==window){
        window.parent.postMessage(payload,origin);
        window.parent.postMessage(payload,"*");
      }
    }catch(e){}
    try{
      var bc=new BroadcastChannel("grok-auth");
      bc.postMessage(payload);
      setTimeout(function(){try{bc.close();}catch(e){}},400);
    }catch(e){}
  }

  store(payload.token||TOKEN);
  notify();

  var codeEl=document.getElementById("code");
  if(codeEl) codeEl.textContent=CODE;
  var who=document.getElementById("who");
  if(who&&LABEL) who.textContent=LABEL;

  // Always show the warn on mobile-ish UAs; X in-app especially
  var ua=navigator.userAgent||"";
  var inApp=/Twitter|TwitterAndroid|\\bX\\/|FBAN|FBAV|Instagram|Line\\/|Snapchat|GSA\\//i.test(ua)
    || (/iPhone|iPad|Android/i.test(ua));
  // keep warn always visible on small screens
  if(window.innerWidth < 900){
    var w=document.getElementById("inapp");
    if(w) w.style.display="block";
  }

  var dest=(typeof RETURN_TO==="string"&&RETURN_TO.charAt(0)==="/"&&RETURN_TO.charAt(1)!=="/")
    ? RETURN_TO : "/";
  var resume=location.origin+"/login?code="+encodeURIComponent(CODE);
  var open=document.getElementById("open");
  if(open){
    open.setAttribute("href", resume);
    open.textContent=inApp ? "Intentar abrir en el navegador" : "Continuar a la app";
  }

  var copy=document.getElementById("copy");
  if(copy){
    copy.onclick=function(){
      function ok(){
        copy.textContent="¡Copiado!";
        setTimeout(function(){copy.textContent="Copiar código";},1600);
      }
      if(navigator.clipboard&&navigator.clipboard.writeText){
        navigator.clipboard.writeText(CODE).then(ok).catch(function(){
          try{
            var ta=document.createElement("textarea");
            ta.value=CODE; document.body.appendChild(ta); ta.select();
            document.execCommand("copy"); document.body.removeChild(ta); ok();
          }catch(e){}
        });
      }else{
        try{
          var ta=document.createElement("textarea");
          ta.value=CODE; document.body.appendChild(ta); ta.select();
          document.execCommand("copy"); document.body.removeChild(ta); ok();
        }catch(e){}
      }
    };
  }

  // Desktop popup: notify + close. Never auto-redirect away from the code on mobile.
  if(window.opener&&!window.opener.closed && window.innerWidth>=900){
    setTimeout(function(){ try{ window.close(); }catch(e){} }, 600);
  } else if(!inApp && window.innerWidth>=900){
    setTimeout(function(){
      try{ location.replace(dest); }catch(e){ location.href=dest; }
    }, 1000);
  }
})();
</script>
</main></body></html>`;
}

function failPage(error: string, returnTo: string): string {
  const safeErr = JSON.stringify(String(error).slice(0, 200));
  const loginUrl = `/login?auth_error=${encodeURIComponent(String(error).slice(0, 80))}`;
  return `<!doctype html>
<html lang="es"><head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"/>
<meta name="color-scheme" content="dark"/>
<title>Login — reintentar</title>
<style>
html,body{margin:0;min-height:100%;background:#0b0b0c;color:#e4e4e7;
font:15px/1.5 system-ui,-apple-system,sans-serif}
main{min-height:100dvh;display:grid;place-items:center;padding:1rem}
.card{max-width:22rem;width:100%;background:#141416;border:1px solid #27272a;
border-radius:16px;padding:1.25rem 1rem;text-align:center}
.x{color:#f87171;font-size:1.75rem;margin-bottom:.35rem}
h1{margin:0 0 .5rem;font-size:1.15rem;color:#fafafa}
.err{color:#fca5a5;font-size:12px;word-break:break-word;margin:.5rem 0 1rem}
.steps{text-align:left;font-size:13px;color:#d4d4d8;margin:0 0 1rem;padding-left:1.1rem}
.steps li{margin:.35rem 0}
a,button{display:block;width:100%;box-sizing:border-box;margin:.45rem 0 0;
background:#2dd4bf;color:#042f2e;border:0;border-radius:12px;padding:15px 16px;
font:700 15px/1.2 inherit;text-decoration:none;cursor:pointer;text-align:center}
.secondary{background:transparent;color:#2dd4bf;border:1px solid #2dd4bf55}
.hint{font-size:11px;color:#71717a;margin-top:.85rem;line-height:1.4}
.warn{background:#422006;color:#fdba74;border:1px solid #9a341288;border-radius:12px;
padding:.7rem .8rem;font-size:12.5px;text-align:left;margin-bottom:.9rem}
</style></head><body><main>
<div class="card">
  <div class="x">✕</div>
  <h1>No se completó en este navegador</h1>
  <div class="warn">
    <strong>X a menudo abre su propio navegador.</strong>
    Brave no recibe la sesión solo. Vuelve a Brave y usa el código de 6 dígitos
    (si lo viste) o reintenta el login.
  </div>
  <p class="err" id="e"></p>
  <ol class="steps">
    <li>Cierra esta pestaña de X.</li>
    <li>Abre <strong>Brave</strong> con la app.</li>
    <li>Login → <strong>Continuar con X</strong> de nuevo, o pega el código si lo tienes.</li>
  </ol>
  <a href="${loginUrl}">Ir a login (Brave)</a>
  <a class="secondary" href="/login">Tengo un código</a>
  <p class="hint">Si autorizaste bien en X pero ves este error, es normal en móvil:
  la sesión queda en el navegador de X. El puente es el código de 6 dígitos.</p>
</div>
<script>
(function(){
  var err=${safeErr};
  var el=document.getElementById("e");
  if(el){
    if(err==="no_session" || err==="1" || err==="sign_in_failed")
      el.textContent="Sesión no llegó a esta ventana (típico en X móvil).";
    else el.textContent=String(err);
  }
  // Do NOT auto-redirect — user needs time to read (esp. in X in-app browser)
})();
</script>
</main></body></html>`;
}

export const Route = createFileRoute("/api/oauth/done")({
  server: {
    handlers: {
      GET: ({ request }) => handleDone(request),
    },
  },
});
