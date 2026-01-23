// app.js
const API_KEY = "72f0a0fa086259c4fc4b8bf0b856e446";
const BASE = "https://api.themoviedb.org/3";
const IMG = "https://image.tmdb.org/t/p/w500";

const grid = document.getElementById("movies");
const search = document.getElementById("search");
const tabs = document.querySelectorAll(".tab");

let currentType = "movie";

// Load default movies
load(`${BASE}/movie/popular?api_key=${API_KEY}`);

// Tab click logic
tabs.forEach(tab => {
  tab.onclick = () => {
    tabs.forEach(t => t.classList.remove("active"));
    tab.classList.add("active");
    currentType = tab.dataset.type;
    load(`${BASE}/${currentType}/popular?api_key=${API_KEY}`);
  };
});

// Search logic
search.oninput = e => {
  const q = e.target.value.trim();
  if (!q) return load(`${BASE}/${currentType}/popular?api_key=${API_KEY}`);
  load(`${BASE}/search/${currentType}?api_key=${API_KEY}&query=${encodeURIComponent(q)}`);
};

// Fetch data from TMDB
async function load(url) {
  try {
    const res = await fetch(url);
    const data = await res.json();
    render(data.results);
  } catch (err) {
    console.error("Failed to fetch:", err);
    grid.innerHTML = "<p style='color:red'>Failed to load content.</p>";
  }
}

// Render movies/shows as non-clickable cards
function render(items) {
  grid.innerHTML = "";

  items.forEach(item => {
    if (!item.poster_path) return;

    const title = item.title || item.name;

    // Create a non-clickable div
    const card = document.createElement("div");
    card.className = "movie"; // keeps your CSS styling
    card.style.cursor = "default"; // optional: shows it's not clickable
    card.style.textDecoration = "none";
    card.style.color = "inherit";

    card.innerHTML = `
      <img src="${IMG + item.poster_path}" alt="${title}" />
      <h3>${title}</h3>
      <span>⭐ ${item.vote_average}</span>
    `;

    grid.appendChild(card);
  });
}
