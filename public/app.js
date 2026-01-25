const API_KEY = "72f0a0fa086259c4fc4b8bf0b856e446";
const BASE = "https://api.themoviedb.org/3";
const IMG = "https://image.tmdb.org/t/p/w500";

const grid = document.getElementById("movies");
const search = document.getElementById("search");
const tabs = document.querySelectorAll(".tab");

let currentType = "movie";
let currentItemId = null;

// Overlay elements
const overlay = document.getElementById("overlay");
const closeOverlay = document.getElementById("closeOverlay");
const overlayTitle = document.getElementById("overlayTitle");
const overlayDesc = document.getElementById("overlayDesc");
const overlayRating = document.getElementById("overlayRating");
const overlayDate = document.getElementById("overlayDate");
const overlayVotes = document.getElementById("overlayVotes");
const overlayPoster = document.getElementById("overlayPoster");
const playButton = document.getElementById("playButton");
const tvControls = document.getElementById("tvControls");
const seasonSelect = document.getElementById("seasonSelect");
const episodeSelect = document.getElementById("episodeSelect");

// Load default movies
load(`${BASE}/movie/popular?api_key=${API_KEY}`);

// Tab click logic
tabs.forEach(tab => {
  tab.onclick = () => {
    tabs.forEach(t => t.classList.remove("active"));
    tab.classList.add("active");
    currentType = tab.dataset.type;
    search.value = "";
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

// Render movies/shows
function render(items) {
  grid.innerHTML = "";
  items.forEach(item => {
    if (!item.poster_path) return;
    const title = item.title || item.name;
    const card = document.createElement("div");
    card.className = "movie";
    card.innerHTML = `
      <div class="movie-poster">
        <img src="${IMG + item.poster_path}" alt="${title}" />
        <div class="play-overlay">
          <div class="play-icon">▶</div>
        </div>
      </div>
      <div class="movie-info">
        <h3>${title}</h3>
        <span>⭐ ${item.vote_average}</span>
      </div>
    `;
    
    // Show overlay on click
    card.onclick = () => {
      currentItemId = item.id;
      overlayTitle.textContent = title;
      overlayDesc.textContent = item.overview || "No description available.";
      overlayRating.textContent = item.vote_average;
      overlayDate.textContent = item.release_date || item.first_air_date || "N/A";
      overlayVotes.textContent = item.vote_count || 0;
      overlayPoster.src = IMG + item.poster_path;
      
      // Show/hide TV controls
      if (currentType === "tv") {
        tvControls.classList.remove("hidden");
        seasonSelect.value = 1;
        episodeSelect.value = 1;
      } else {
        tvControls.classList.add("hidden");
      }
      
      overlay.classList.remove("hidden");
    };
    
    grid.appendChild(card);
  });
}

// Play button click
playButton.onclick = () => {
  let playerUrl = `tvplayer.html?type=${currentType}&id=${currentItemId}`;
  
  if (currentType === "tv") {
    const season = seasonSelect.value || 1;
    const episode = episodeSelect.value || 1;
    playerUrl += `&season=${season}&episode=${episode}`;
  }
  
  window.location.href = playerUrl;
};

// Close overlay
closeOverlay.onclick = () => overlay.classList.add("hidden");
overlay.onclick = e => {
  if (e.target === overlay) overlay.classList.add("hidden");
};
