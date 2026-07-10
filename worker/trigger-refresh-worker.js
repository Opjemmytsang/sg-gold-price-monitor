// Cloudflare Worker for securely triggering the GitHub Actions price refresh workflow.
//
// Required Worker secrets / variables:
// - GITHUB_TOKEN: fine-grained GitHub token with Actions: write permission for Opjemmytsang/sg-gold-price-monitor
// - ALLOWED_ORIGIN: your GitHub Pages origin, for example https://opjemmytsang.github.io
//
// Optional variables:
// - OWNER: default Opjemmytsang
// - REPO: default sg-gold-price-monitor
// - WORKFLOW_FILE: default check-prices.yml
// - REF: default main

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    const allowedOrigin = env.ALLOWED_ORIGIN || "*";
    const corsOrigin = allowedOrigin === "*" ? "*" : allowedOrigin;

    const corsHeaders = {
      "Access-Control-Allow-Origin": corsOrigin,
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Content-Type": "application/json"
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    if (request.method !== "POST") {
      return new Response(JSON.stringify({ ok: false, error: "Method not allowed" }), { status: 405, headers: corsHeaders });
    }

    if (allowedOrigin !== "*" && origin !== allowedOrigin) {
      return new Response(JSON.stringify({ ok: false, error: "Origin not allowed" }), { status: 403, headers: corsHeaders });
    }

    if (!env.GITHUB_TOKEN) {
      return new Response(JSON.stringify({ ok: false, error: "Missing GITHUB_TOKEN" }), { status: 500, headers: corsHeaders });
    }

    const owner = env.OWNER || "Opjemmytsang";
    const repo = env.REPO || "sg-gold-price-monitor";
    const workflowFile = env.WORKFLOW_FILE || "check-prices.yml";
    const ref = env.REF || "main";

    const response = await fetch(`https://api.github.com/repos/${owner}/${repo}/actions/workflows/${workflowFile}/dispatches`, {
      method: "POST",
      headers: {
        "Accept": "application/vnd.github+json",
        "Authorization": `Bearer ${env.GITHUB_TOKEN}`,
        "User-Agent": "sg-gold-price-monitor-refresh-worker",
        "X-GitHub-Api-Version": "2022-11-28"
      },
      body: JSON.stringify({
        ref,
        inputs: { send_quote: "false" }
      })
    });

    if (!response.ok) {
      const text = await response.text();
      return new Response(JSON.stringify({ ok: false, status: response.status, error: text }), { status: 502, headers: corsHeaders });
    }

    return new Response(JSON.stringify({ ok: true, message: "Refresh workflow triggered" }), { status: 202, headers: corsHeaders });
  }
};
