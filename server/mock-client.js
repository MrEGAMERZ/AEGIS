// Simulates the Aegis extension calling the backend:
// sends a sanitized image + page structure, expects a single action JSON.
const BASE = process.env.BASE_URL || "http://127.0.0.1:8000";

async function main() {
  const health = await fetch(`${BASE}/health`).then((r) => r.json());
  console.log("health:", JSON.stringify(health, null, 2));
  if (!health.upstreamReachable && !health.mock) {
    console.error("Upstream unreachable and mock mode is off. Start the VLM runtime or use --mock.");
    process.exit(1);
  }

  const payload = {
    model: health.upstream.model,
    messages: [
      {
        role: "system",
        content: "You are a browser automation agent. Return a single JSON action object.",
      },
      {
        role: "user",
        content: [
          {
            type: "image_url",
            image_url: {
              url:
                "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
            },
          },
          {
            type: "text",
            text:
              'Page structure: {"url":"https://example.com/login","title":"Sign In","fields":[{"selector":"#email","type":"email","label":"Email"},{"selector":"#password","type":"password","label":"Password"},{"selector":"#submit","type":"submit","label":"Sign in"}],"maskedRegions":[]}\n\nTask: Fill the login form and submit',
          },
        ],
      },
    ],
    max_tokens: 256,
    temperature: 0.1,
  };

  const started = Date.now();
  const res = await fetch(`${BASE}/v1/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  const latencyMs = Date.now() - started;

  console.log("status:", res.status, "| latency:", latencyMs + "ms", "| x-aegis-latency:", res.headers.get("x-aegis-latency-ms"));
  console.log("raw content:", data.choices?.[0]?.message?.content);
  const action = JSON.parse(data.choices[0].message.content);
  console.log("parsed action:", JSON.stringify(action, null, 2));

  if (!action.action) throw new Error("No action in response");
  console.log("OK — contract satisfied");
}

main().catch((e) => {
  console.error("FAIL:", e.message);
  process.exit(1);
});
