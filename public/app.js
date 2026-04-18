const API_KEY = "72f0a0fa086259c4fc4b8bf0b856e446";
const BASE = "https://api.themoviedb.org/3";
const IMG = "https://image.tmdb.org/t/p/w500";

const grid        = document.getElementById("movies");
const search      = document.getElementById("search");
const tabs        = document.querySelectorAll(".tab");

let currentType   = "movie";
let currentItemId = null;
let currentSeasons = 1;
let episodeData   = {};

// Overlay elements
const overlay        = document.getElementById("overlay");
const closeOverlay   = document.getElementById("closeOverlay");
const overlayTitle   = document.getElementById("overlayTitle");
const overlayDesc    = document.getElementById("overlayDesc");
const overlayRating  = document.getElementById("overlayRating");
const overlayDate    = document.getElementById("overlayDate");
const overlayVotes   = document.getElementById("overlayVotes");
const overlayPoster  = document.getElementById("overlayPoster");
const playButton     = document.getElementById("playButton");
const tvControls     = document.getElementById("tvControls");
const seasonSelect   = document.getElementById("seasonSelect");
const episodeSelect  = document.getElementById("episodeSelect");
const episodeInfo    = document.getElementById("episodeInfo");
const episodeTitle   = document.getElementById("episodeTitle");
const episodeOverview = document.getElementById("episodeOverview");
const episodeAirDate = document.getElementById("episodeAirDate");
const episodeRating  = document.getElementById("episodeRating");

// Load default content
load(`${BASE}/movie/popular?api_key=${API_KEY}`);

// Tab switching
tabs.forEach(tab => {
  tab.onclick = () => {
    tabs.forEach(t => t.classList.remove("active"));
    tab.classList.add("active");
    currentType = tab.dataset.type;
    search.value = "";
    load(`${BASE}/${currentType}/popular?api_key=${API_KEY}`);
  };
});

// Search
search.oninput = e => {
  const q = e.target.value.trim();
  if (!q) return load(`${BASE}/${currentType}/popular?api_key=${API_KEY}`);
  load(`${BASE}/search/${currentType}?api_key=${API_KEY}&query=${encodeURIComponent(q)}`);
};

// Fetch from TMDB
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

// Render grid
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
        <span>⭐ ${item.vote_average.toFixed(1)}</span>
      </div>
    `;
    card.onclick = () => showDetails(item);
    grid.appendChild(card);
  });
}

// ── SHOW DETAILS OVERLAY ──────────────────────────────────────────────────────
// BUG FIX: We snapshot the item's ID at click time and check it before
// applying any async results — so fast-clicking different cards never
// shows stale data from a previous card's pending async calls.
async function showDetails(item) {
  const clickedId = item.id; // capture at click time

  // ── Clear ALL previous state immediately ──
  currentItemId  = item.id;
  currentSeasons = 1;
  episodeData    = {};

  // ── Fill in the fields we already have from the grid data ──
  overlayTitle.textContent  = item.title || item.name;
  overlayDesc.textContent   = item.overview || "No description available.";
  overlayRating.textContent = item.vote_average.toFixed(1);
  overlayDate.textContent   = item.release_date || item.first_air_date || "N/A";
  overlayVotes.textContent  = (item.vote_count || 0).toLocaleString();
  overlayPoster.src         = IMG + item.poster_path;

  // ── Reset TV controls ──
  episodeInfo.classList.add("hidden");
  seasonSelect.innerHTML  = "<option>Loading seasons...</option>";
  episodeSelect.innerHTML = "<option>Loading episodes...</option>";

  const type = item.media_type || currentType;

  if (type === "tv") {
    tvControls.classList.remove("hidden");
  } else {
    tvControls.classList.add("hidden");
  }

  // Show overlay right away with what we have
  overlay.classList.remove("hidden");

  // ── Load TV details asynchronously ──
  if (type === "tv") {
    try {
      await loadTVShowDetails(item.id, clickedId);
    } catch(e) {
      // If a newer card was clicked, ignore
      if (currentItemId !== clickedId) return;
      episodeSelect.innerHTML = "<option>Failed to load</option>";
    }
  }
}

// Load seasons for a TV show
async function loadTVShowDetails(tvId, clickedId) {
  const res  = await fetch(`${BASE}/tv/${tvId}?api_key=${API_KEY}`);
  const data = await res.json();

  // Guard: user may have clicked a different card while this was loading
  if (currentItemId !== clickedId) return;

  currentSeasons = data.number_of_seasons;

  seasonSelect.innerHTML = "";
  for (let i = 1; i <= currentSeasons; i++) {
    const option = document.createElement("option");
    option.value = i;
    option.textContent = `Season ${i}`;
    seasonSelect.appendChild(option);
  }

  await loadEpisodes(tvId, 1, clickedId);
}

// Load episodes for a season
async function loadEpisodes(tvId, season, clickedId) {
  // Guard
  if (currentItemId !== clickedId) return;

  episodeSelect.innerHTML = "<option>Loading...</option>";

  const res  = await fetch(`${BASE}/tv/${tvId}/season/${season}?api_key=${API_KEY}`);
  const data = await res.json();

  // Guard again after await
  if (currentItemId !== clickedId) return;

  episodeData[season] = data.episodes || [];

  episodeSelect.innerHTML = "";
  (data.episodes || []).forEach(ep => {
    const option = document.createElement("option");
    option.value = ep.episode_number;
    option.textContent = `${ep.episode_number}. ${ep.name}`;
    episodeSelect.appendChild(option);
  });

  showEpisodeInfo(season, 1);
}

// Show episode info panel
function showEpisodeInfo(season, episodeNum) {
  const episodes = episodeData[season];
  if (!episodes || !episodes.length) return;

  const episode = episodes.find(ep => ep.episode_number == episodeNum);
  if (!episode) return;

  episodeInfo.classList.remove("hidden");
  episodeTitle.textContent    = episode.name || "";
  episodeOverview.textContent = episode.overview || "No description available.";
  episodeAirDate.textContent  = episode.air_date ? `📅 ${episode.air_date}` : "";
  episodeRating.textContent   = episode.vote_average ? `⭐ ${episode.vote_average.toFixed(1)}` : "";
}

// Season change
seasonSelect.onchange = async function() {
  const season     = parseInt(this.value);
  const clickedId  = currentItemId; // snapshot

  if (episodeData[season]) {
    // Already cached
    episodeSelect.innerHTML = "";
    episodeData[season].forEach(ep => {
      const option = document.createElement("option");
      option.value = ep.episode_number;
      option.textContent = `${ep.episode_number}. ${ep.name}`;
      episodeSelect.appendChild(option);
    });
    showEpisodeInfo(season, 1);
  } else {
    await loadEpisodes(currentItemId, season, clickedId);
  }
};

// Episode change
episodeSelect.onchange = function() {
  const season  = parseInt(seasonSelect.value);
  const episode = parseInt(this.value);
  showEpisodeInfo(season, episode);
};

// Play button
playButton.onclick = () => {
  const type = tvControls.classList.contains("hidden") ? "movie" : "tv";
  let playerUrl = `tvplayer.html?type=${type}&id=${currentItemId}`;

  if (type === "tv") {
    const season  = seasonSelect.value  || 1;
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
