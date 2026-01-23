const API_KEY = "72f0a0fa086259c4fc4b8bf0b856e446";
const BASE_URL = "https://api.themoviedb.org/3";
const IMG_URL = "https://image.tmdb.org/t/p/w500";

const moviesEl = document.getElementById("movies");
const searchInput = document.getElementById("search");

// Load popular movies on start
getMovies(`${BASE_URL}/movie/popular?api_key=${API_KEY}`);

async function getMovies(url) {
  const res = await fetch(url);
  const data = await res.json();
  showMovies(data.results);
}

function showMovies(movies) {
  moviesEl.innerHTML = "";

  movies.forEach(movie => {
    const movieEl = document.createElement("div");
    movieEl.classList.add("movie");

    movieEl.innerHTML = `
      <img src="${movie.poster_path ? IMG_URL + movie.poster_path : ''}" />
      <div class="movie-info">
        <h3>${movie.title}</h3>
        <span>⭐ ${movie.vote_average}</span>
      </div>
    `;

    moviesEl.appendChild(movieEl);
  });
}

// Search
searchInput.addEventListener("keyup", (e) => {
  const query = e.target.value;
  if (query.trim()) {
    getMovies(`${BASE_URL}/search/movie?api_key=${API_KEY}&query=${query}`);
  } else {
    getMovies(`${BASE_URL}/movie/popular?api_key=${API_KEY}`);
  }
});
