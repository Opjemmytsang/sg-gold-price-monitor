const GITHUB_API = "https://api.github.com";

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8"
    }
  });
}

async function triggerWorkflow(env, source = "manual") {
  const owner = env.GITHUB_OWNER || "Opjemmytsang";
  const repo = env.GITHUB_REPO || "sg-gold-price-monitor";
  const workflow = env.GITHUB_WORKFLOW || "check-prices.yml";
  const ref = env.GITHUB_REF || "main";

  if (!env.GITHUB_TOKEN) {
    return {
      ok: false,
      status: 500,
      message: "Missing GITHUB_TOKEN secret."
    };
  }

  const url = `${GITHUB_API}/repos/${owner}/${repo}/actions/workflows/${workflow}/dispatches`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "authorization": `Bearer ${env.GITHUB_TOKEN}`,
      "accept": "application/vnd.github+json",
      "content-type": "application/json",
      "user-agent": "sg-gold-price-monitor-worker"
    },
    body: JSON.stringify({
      ref,
      inputs: {
        send_quote: "false"
      }
    })
  });

  if (!response.ok) {
    const text = await response.text();
    return {
      ok: false,
      status: response.status,
      message: text
    };
  }

  return {
    ok: true,
    status: response.status,
    source,
    workflow,
    ref,
    triggeredAt: new Date().toISOString()
  };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/health") {
      return jsonResponse({ ok: true, service: "sg-gold-price-monitor-worker" });
    }

    if (url.pathname === "/trigger") {
      const expectedKey = env.TRIGGER_KEY;
      if (expectedKey && url.searchParams.get("key") !== expectedKey) {
        return jsonResponse({ ok: false, message: "Unauthorized" }, 401);
      }
      const result = await triggerWorkflow(env, "http");
      return jsonResponse(result, result.ok ? 200 : 500);
    }

    return jsonResponse({
      ok: true,
      message: "Singapore Gold Monitor Worker is running.",
      endpoints: ["/health", "/trigger?key=YOUR_TRIGGER_KEY"]
    });
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(triggerWorkflow(env, "cron"));
  }
};
