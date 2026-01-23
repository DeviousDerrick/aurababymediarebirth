import express from "express";
import fetch from "node-fetch";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 8080;

// Serve frontend
app.use(express.static(path.join(__dirname, "public")));

// CORS (needed for embeds)
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "*");
  next();
});

// Encode helper
function encode(url) {
  return Buffer.from(url).toString("base64url");
}
function decode(str) {
  return Buffer.from(str, "base64url").toString();
}

// Encode endpoint
app.get("/api/encode", (req, res) => {
  const url = req.query.url;
  if (!url) return res.status(400).json({ error: "Missing url" });
  res.json({ proxy: `/ocho/${encode(url)}` });
});

// Proxy
app.use("/ocho/:url", async (req, res) => {
  try {
    const target = decode(req.params.url);
    const response = await fetch(target, {
      headers: {
        "User-Agent": "Mozilla/5.0",
        Referer: target
      }
    });
    res.set("Content-Type", response.headers.get("content-type"));
    response.body.pipe(res);
  } catch (e) {
    res.status(500).send("Proxy error");
  }
});

app.listen(PORT, () =>
  console.log("AuraBaby Media running on port", PORT)
);
