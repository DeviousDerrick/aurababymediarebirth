const API_KEY = "72f0a0fa086259c4fc4b8bf0b856e446";
const BASE_URL = "https://api.themoviedb.org/3";
const IMG_URL = "https://image.tmdb.org/t/p/w500";

const moviesEl = document.getElementById("movies");
const searchInput = document.getElementById("search");
const tabs = document.querySelectorAll("#tabs .tab");

let currentType = "movie"; // default

// Load default movies
getItems(`${BASE_URL}/movie/popular?api_key=${API_KEY}`);

// ===== Tabs logic =====
tabs.forEach(tab => {
  tab.addEventListener("click", () => {
    // Remove active from all
    tabs.forEach(t => t.classList.remove("active"));
    tab.classList.add("active");

    currentType = tab.dataset.type; // movie or tv

    // Fetch popular movies or shows
    getItems(`${BASE_URL}/${currentType}/popular?api_key=${API_KEY}`);
    searchInput.value = ""; // clear search
  });
});

// ===== Fetch function =====
async function getItems(url) {
  try {
    const res = await fetch(url);
    const data = await res.json();
    showItems(data.results);
  } catch (err) {
    console.error("Failed to fetch items:", err);
    moviesEl.innerHTML = "<p style='color:red'>Failed to load content.</p>";
  }
}

function showItems(items) {
  moviesEl.innerHTML = "";

  items.forEach(item => {
    const movieEl = document.createElement("div");
    movieEl.className = "movie";

    movieEl.innerHTML = `
      <img src="${item.poster_path ? IMG_URL + item.poster_path : ''}" alt="${item.name || item.title}">
      <div class="movie-info">
        <h3>${item.title || item.name}</h3>
        <span>⭐ ${item.vote_average}</span>
      </div>
    `;

    moviesEl.appendChild(movieEl);
  });
}

// ===== Search logic =====
searchInput.addEventListener("input", e => {
  const query = e.target.value.trim();
  if (!query) {
    getItems(`${BASE_URL}/${currentType}/popular?api_key=${API_KEY}`);
    return;
  }

  getItems(`${BASE_URL}/search/${currentType}?api_key=${API_KEY}&query=${encodeURIComponent(query)}`);
});
