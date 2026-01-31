const API_KEY = "72f0a0fa086259c4fc4b8bf0b856e446";
const BASE = "https://api.themoviedb.org/3";
const IMG = "https://image.tmdb.org/t/p/w500";

const grid = document.getElementById("movies");
const search = document.getElementById("search");
const tabs = document.querySelectorAll(".tab");

let currentType = "movie";
let currentItemId = null;
let currentSeasons = 1;
let episodeData = {};

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
const episodeInfo = document.getElementById("episodeInfo");
const episodeTitle = document.getElementById("episodeTitle");
const episodeOverview = document.getElementById("episodeOverview");
const episodeAirDate = document.getElementById("episodeAirDate");
const episodeRating = document.getElementById("episodeRating");

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
    grid.innerHTML = "<p style='color:red; padding:30px; text-align:center;'>Failed to load content. Check your connection.</p>";
  }
}

// Render movies/shows
function render(items) {
  grid.innerHTML = "";
  if (!items || items.length === 0) {
    grid.innerHTML = "<p style='color:#87ceeb; padding:30px; text-align:center; grid-column:1/-1;'>No results found.</p>";
    return;
  }
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
        <span>⭐ ${item.vote_average.toFixed(1)}</span>
      </div>
    `;
    card.onclick = () => showDetails(item);
    grid.appendChild(card);
  });
}

// Show details overlay
async function showDetails(item) {
  currentItemId = item.id;
  overlayTitle.textContent = item.title || item.name;
  overlayDesc.textContent = item.overview || "No description available.";
  overlayRating.textContent = item.vote_average.toFixed(1);
  overlayDate.textContent = item.release_date || item.first_air_date || "N/A";
  overlayVotes.textContent = item.vote_count || 0;
  overlayPoster.src = IMG + item.poster_path;

  if (currentType === "tv") {
    tvControls.classList.remove("hidden");
    await loadTVShowDetails(item.id);
  } else {
    tvControls.classList.add("hidden");
  }

  overlay.classList.remove("hidden");
}

// Load TV show details (seasons)
async function loadTVShowDetails(tvId) {
  try {
    const res = await fetch(`${BASE}/tv/${tvId}?api_key=${API_KEY}`);
    const data = await res.json();

    currentSeasons = data.number_of_seasons;

    seasonSelect.innerHTML = "";
    for (let i = 1; i <= currentSeasons; i++) {
      const option = document.createElement("option");
      option.value = i;
      option.textContent = `Season ${i}`;
      seasonSelect.appendChild(option);
    }

    // Reset episode data cache for this show
    episodeData = {};
    await loadEpisodes(tvId, 1);
  } catch (err) {
    console.error("Failed to load TV details:", err);
  }
}

// Load episodes for a season
async function loadEpisodes(tvId, season) {
  try {
    episodeSelect.innerHTML = "<option>Loading...</option>";

    const res = await fetch(`${BASE}/tv/${tvId}/season/${season}?api_key=${API_KEY}`);
    const data = await res.json();

    episodeData[season] = data.episodes;

    episodeSelect.innerHTML = "";
    data.episodes.forEach((ep) => {
      const option = document.createElement("option");
      option.value = ep.episode_number;
      option.textContent = `${ep.episode_number}. ${ep.name}`;
      episodeSelect.appendChild(option);
    });

    showEpisodeInfo(season, data.episodes[0]?.episode_number || 1);
  } catch (err) {
    console.error("Failed to load episodes:", err);
    episodeSelect.innerHTML = "<option>Failed to load</option>";
  }
}

// Show episode info card
function showEpisodeInfo(season, episodeNum) {
  const episodes = episodeData[season];
  if (!episodes) return;

  const episode = episodes.find(ep => ep.episode_number == episodeNum);
  if (!episode) return;

  episodeInfo.classList.remove("hidden");
  episodeTitle.textContent = episode.name;
  episodeOverview.textContent = episode.overview || "No description available.";
  episodeAirDate.textContent = episode.air_date ? `📅 ${episode.air_date}` : "";
  episodeRating.textContent = episode.vote_average ? `⭐ ${episode.vote_average.toFixed(1)}` : "";
}

// Season dropdown change
seasonSelect.onchange = async function () {
  const season = parseInt(this.value);

  if (!episodeData[season]) {
    await loadEpisodes(currentItemId, season);
  } else {
    episodeSelect.innerHTML = "";
    episodeData[season].forEach((ep) => {
      const option = document.createElement("option");
      option.value = ep.episode_number;
      option.textContent = `${ep.episode_number}. ${ep.name}`;
      episodeSelect.appendChild(option);
    });
    showEpisodeInfo(season, episodeData[season][0]?.episode_number || 1);
  }
};

// Episode dropdown change
episodeSelect.onchange = function () {
  const season = parseInt(seasonSelect.value);
  const episode = parseInt(this.value);
  showEpisodeInfo(season, episode);
};

// Play button — navigate to the player page
playButton.onclick = () => {
  let playerUrl = `tvplayer.html?type=${currentType}&id=${currentItemId}`;

  if (currentType === "tv") {
    const season = seasonSelect.value || "1";
    const episode = episodeSelect.value || "1";
    playerUrl += `&season=${season}&episode=${episode}`;
  }

  window.location.href = playerUrl;
};

// Close overlay
closeOverlay.onclick = () => overlay.classList.add("hidden");
overlay.onclick = e => {
  if (e.target === overlay) overlay.classList.add("hidden");
};
