const API_KEY = "72f0a0fa086259c4fc4b8bf0b856e446";
const BASE = "https://api.themoviedb.org/3";
const IMG = "https://image.tmdb.org/t/p/w500";

const grid = document.getElementById("movies");
const search = document.getElementById("search");
const tabs = document.querySelectorAll(".tab");

let currentType = "movie";

load(`${BASE}/movie/popular?api_key=${API_KEY}`);

tabs.forEach(tab => {
  tab.onclick = () => {
    tabs.forEach(t => t.classList.remove("active"));
    tab.classList.add("active");
    currentType = tab.dataset.type;
    load(`${BASE}/${currentType}/popular?api_key=${API_KEY}`);
  };
});

search.oninput = e => {
  const q = e.target.value.trim();
  if (!q) return load(`${BASE}/${currentType}/popular?api_key=${API_KEY}`);
  load(`${BASE}/search/${currentType}?api_key=${API_KEY}&query=${q}`);
};

async function load(url) {
  const res = await fetch(url);
  const data = await res.json();
  render(data.results);
}

function render(items) {
  grid.innerHTML = "";

  items.forEach(item => {
    if (!item.poster_path) return;

    const title = item.title || item.name;

    const link = document.createElement("a");
    link.href =
      `/tvplayer.html?id=${item.id}&title=${encodeURIComponent(title)}&season=1&episode=1&source=vidfast`;
    link.className = "movie";
    link.style.textDecoration = "none";
    link.style.color = "inherit";

    link.innerHTML = `
      <img src="https://image.tmdb.org/t/p/w500${item.poster_path}" />
      <h3>${title}</h3>
    `;

    grid.appendChild(link);
  });
}
