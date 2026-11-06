import express from "express";
import cors from "cors";

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: "50mb" }));

const RETIRED_PREFIX = "claude-sonnet-4-5";
const REPLACEMENT_MODEL = process.env.MODEL_OVERRIDE || "claude-sonnet-5-5";
function resolveModel(model) {
  if (typeof model === "string" && model.startsWith(RETIRED_PREFIX)) {
    return REPLACEMENT_MODEL;
  }
  return model;
}

app.post("/api/messages", async (req, res) => {
  try {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    const isStreaming = req.body.stream === true;
    req.body.model = resolveModel(req.body.model);
    if (typeof req.body.model === "string" && req.body.model.startsWith("claude-sonnet-5")) {
      if (!req.body.thinking) {
        req.body.thinking = { type: "between_tools" };
      }
      if (!isStreaming) {
        req.body.max_tokens = Math.min(Math.round((req.body.max_tokens || 4096) * 1.5), 16000);
      }
    }

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(req.body),
    });

    if (isStreaming) {
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");
      response.body.pipeTo(
        new WritableStream({
          write(chunk) {
            res.write(chunk);
          },
          close() {
            res.end();
          },
        })
      );
    } else {
      const data = await response.json();
      console.log("proxy response", {
        status: response.status,
        type: data.type,
        error: data.error,
        stop_reason: data.stop_reason,
        content_types: Array.isArray(data.content) ? data.content.map((b) => b.type) : undefined,
      });
      if (Array.isArray(data.content)) {
        data.content = data.content.filter((b) => b.type !== "thinking" && b.type !== "redacted_thinking");
      }
      res.json(data);
    }
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/health", (req, res) => res.status(200).send("ok"));
app.listen(PORT, () => console.log(`Proxy running on port ${PORT}`));
