// ===== TMDB Constants =====
const API_KEY = "72f0a0fa086259c4fc4b8bf0b856e446"; // Only for testing
const BASE_URL = "https://api.themoviedb.org/3";
const IMG_URL = "https://image.tmdb.org/t/p/w500";

// ===== DOM Elements =====
const moviesEl = document.getElementById("movies");
const searchInput = document.getElementById("search");

// ===== Load Popular Movies on Start =====
getMovies(`${BASE_URL}/movie/popular?api_key=${API_KEY}`);

// ===== Functions =====
async function getMovies(url) {
  try {
    const res = await fetch(url);
    const data = await res.json();
    showMovies(data.results);
  } catch (err) {
    console.error("Failed to fetch movies:", err);
    moviesEl.innerHTML = "<p style='color:red'>Failed to load movies.</p>";
  }
}

function showMovies(movies) {
  moviesEl.innerHTML = "";

  movies.forEach(movie => {
    const movieEl = document.createElement("div");
    movieEl.className = "movie";

    movieEl.innerHTML = `
      <img src="${movie.poster_path ? IMG_URL + movie.poster_path : ''}" alt="${movie.title}">
      <div class="movie-info">
        <h3>${movie.title}</h3>
        <span>⭐ ${movie.vote_average}</span>
      </div>
    `;

    moviesEl.appendChild(movieEl);
  });
}

// ===== Search Movies =====
searchInput.addEventListener("input", e => {
  const query = e.target.value.trim();

  if (query) {
    getMovies(`${BASE_URL}/search/movie?api_key=${API_KEY}&query=${encodeURIComponent(query)}`);
  } else {
    getMovies(`${BASE_URL}/movie/popular?api_key=${API_KEY}`);
  }
});
