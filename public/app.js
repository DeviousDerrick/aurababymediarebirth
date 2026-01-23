const API_KEY = "72f0a0fa086259c4fc4b8bf0b856e446";
const BASE_URL = "https://api.themoviedb.org/3";
const IMG_URL = "https://image.tmdb.org/t/p/w500";

const moviesEl = document.getElementById("movies");
const searchInput = document.getElementById("search");
const tabs = document.querySelectorAll("#tabs .tab");
let currentType = "movie";

// Load default movies
getItems(`${BASE_URL}/movie/popular?api_key=${API_KEY}`);

tabs.forEach(tab => {
  tab.addEventListener("click", () => {
    tabs.forEach(t => t.classList.remove("active"));
    tab.classList.add("active");
    currentType = tab.dataset.type;
    searchInput.value = "";
    getItems(`${BASE_URL}/${currentType}/popular?api_key=${API_KEY}`);
  });
});

searchInput.addEventListener("input", e => {
  const query = e.target.value.trim();
  if (!query) {
    getItems(`${BASE_URL}/${currentType}/popular?api_key=${API_KEY}`);
    return;
  }
  getItems(`${BASE_URL}/search/${currentType}?api_key=${API_KEY}&query=${encodeURIComponent(query)}`);
});

async function getItems(url) {
  try {
    const res = await fetch(url);
    const data = await res.json();
    showItems(data.results);
  } catch {
    moviesEl.innerHTML = "<p style='color:red'>Failed to load content.</p>";
  }
}

function showItems(items) {
  moviesEl.innerHTML = "";
  if (!items || !items.length) {
    moviesEl.innerHTML = "<p style='color:#aaa'>No movies or shows found.</p>";
    return;
  }

  items.forEach(item => {
    if (!item.poster_path) return;
    const title = item.title || item.name;
    const rating = item.vote_average || 0;

    const movieEl = document.createElement("div");
    movieEl.className = "movie";

    movieEl.innerHTML = `
      <img src="${IMG_URL + item.poster_path}" alt="${title}" />
      <h3>${title}</h3>
      <span>⭐ ${rating}</span>
    `;

    moviesEl.appendChild(movieEl);
  });
}
