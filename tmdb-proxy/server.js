const express = require("express");
const fetch = require("node-fetch");
const cors = require("cors");

const app = express();
app.use(cors());

const API_KEY = process.env.TMDB_KEY;
const BASE_URL = "https://api.themoviedb.org/3";

app.get("/popular", async (req, res) => {
  const r = await fetch(`${BASE_URL}/movie/popular?api_key=${API_KEY}`);
  const data = await r.json();
  res.json(data);
});

app.get("/search", async (req, res) => {
  const q = req.query.q;
  const r = await fetch(`${BASE_URL}/search/movie?api_key=${API_KEY}&query=${q}`);
  const data = await r.json();
  res.json(data);
});

app.listen(3000, () => {
  console.log("Proxy running");
});
