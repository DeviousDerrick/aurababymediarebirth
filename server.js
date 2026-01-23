import express from "express";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 8080;

// Serve frontend
app.use(express.static(path.join(__dirname, "public")));

// CORS (optional, safe to keep)
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "*");
  next();
});

// No proxy, no encoding — everything is static now

app.listen(PORT, () =>
  console.log(`AuraBaby Media running on port ${PORT}`)
);
