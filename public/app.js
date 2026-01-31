const API_KEY = "72f0a0fa086259c4fc4b8bf0b856e446";
const BASE = "https://api.themoviedb.org/3";
const IMG = "https://image.tmdb.org/t/p/w500";

const grid = document.getElementById("movies");
const search = document.getElementById("search");
const tabs = document.querySelectorAll(".tab");

// Continue watching elements
const continueSection = document.getElementById("continueSection");
const continueGrid = document.getElementById("continueGrid");
const continueEmpty = document.getElementById("continueEmpty");
const clearContinueBtn = document.getElementById("clearContinue");

// Watchlist elements
const watchlistSection = document.getElementById("watchlistSection");
const watchlistGrid = document.getElementById("watchlistGrid");
const watchlistEmpty = document.getElementById("watchlistEmpty");
const clearWatchlistBtn = document.getElementById("clearWatchlist");

let currentType = "movie";
let currentItemId = null;
let currentItem = null;
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

// Watchlist buttons
const addToWatchlistBtn = document.getElementById("addToWatchlist");
const removeFromWatchlistBtn = document.getElementById("removeFromWatchlist");

// ========== LOCAL STORAGE FUNCTIONS ==========

function getContinueWatching() {
  const data = localStorage.getItem('continueWatching');
  return data ? JSON.parse(data) : [];
}

function saveContinueWatching(items) {
  localStorage.setItem('continueWatching', JSON.stringify(items));
}

function addToContinueWatching(item, season = null, episode = null) {
  let continueList = getContinueWatching();
  
  // Remove if already exists (we'll add it to the front)
  continueList = continueList.filter(i => i.id !== item.id);
  
  // Add to front with timestamp and watch info
  const continueItem = {
    ...item,
    addedAt: Date.now(),
    season: season,
    episode: episode,
    type: currentType
  };
  
  continueList.unshift(continueItem);
  
  // Keep only last 20 items
  if (continueList.length > 20) {
    continueList = continueList.slice(0, 20);
  }
  
  saveContinueWatching(continueList);
}

function removeFromContinueWatching(id) {
  let continueList = getContinueWatching();
  continueList = continueList.filter(i => i.id !== id);
  saveContinueWatching(continueList);
}

function clearContinueWatching() {
  if (confirm('Clear all continue watching items?')) {
    localStorage.removeItem('continueWatching');
    loadContinueWatching();
  }
}

function getWatchlist() {
  const data = localStorage.getItem('watchlist');
  return data ? JSON.parse(data) : [];
}

function saveWatchlist(items) {
  localStorage.setItem('watchlist', JSON.stringify(items));
}

function addToWatchlist(item) {
  let watchlist = getWatchlist();
  
  // Check if already in watchlist
  if (watchlist.some(i => i.id === item.id)) {
    return false;
  }
  
  // Add with timestamp and type
  const watchlistItem = {
    ...item,
    addedAt: Date.now(),
    type: currentType
  };
  
  watchlist.unshift(watchlistItem);
  saveWatchlist(watchlist);
  return true;
}

function removeFromWatchlist(id) {
  let watchlist = getWatchlist();
  watchlist = watchlist.filter(i => i.id !== id);
  saveWatchlist(watchlist);
}

function isInWatchlist(id) {
  return getWatchlist().some(i => i.id === id);
}

function clearWatchlist() {
  if (confirm('Clear entire watchlist?')) {
    localStorage.removeItem('watchlist');
    loadWatchlist();
  }
}

// ========== UI FUNCTIONS ==========

function showSection(section) {
  // Hide all sections
  grid.style.display = 'none';
  continueSection.classList.add('hidden');
  watchlistSection.classList.add('hidden');
  
  // Show selected section
  if (section === 'continue') {
    continueSection.classList.remove('hidden');
    loadContinueWatching();
  } else if (section === 'watchlist') {
    watchlistSection.classList.remove('hidden');
    loadWatchlist();
  } else {
    grid.style.display = 'grid';
  }
}

function loadContinueWatching() {
  const continueList = getContinueWatching();
  continueGrid.innerHTML = "";
  
  if (continueList.length === 0) {
    continueEmpty.classList.remove('hidden');
    return;
  }
  
  continueEmpty.classList.add('hidden');
  continueList.forEach(item => {
    const card = createCard(item, true);
    continueGrid.appendChild(card);
  });
}

function loadWatchlist() {
  const watchlist = getWatchlist();
  watchlistGrid.innerHTML = "";
  
  if (watchlist.length === 0) {
    watchlistEmpty.classList.remove('hidden');
    return;
  }
  
  watchlistEmpty.classList.add('hidden');
  watchlist.forEach(item => {
    const card = createCard(item, false, true);
    watchlistGrid.appendChild(card);
  });
}

function createCard(item, isContinue = false, isWatchlist = false) {
  if (!item.poster_path) return document.createElement('div');
  
  const title = item.title || item.name;
  const card = document.createElement("div");
  card.className = "movie";
  
  let badge = '';
  if (isContinue && item.season && item.episode) {
    badge = `<div class="continue-badge">S${item.season}E${item.episode}</div>`;
  }
  if (isWatchlist) {
    badge = `<div class="watchlist-badge">⭐</div>`;
  }
  
  card.innerHTML = `
    <div class="movie-poster">
      ${badge}
      <img src="${IMG + item.poster_path}" alt="${title}" />
      <div class="play-overlay">
        <div class="play-icon">▶</div>
      </div>
      ${isContinue ? `<button class="remove-btn" onclick="event.stopPropagation(); removeFromContinue(${item.id})">✕</button>` : ''}
      ${isWatchlist ? `<button class="remove-btn" onclick="event.stopPropagation(); removeFromWatchlistUI(${item.id})">✕</button>` : ''}
    </div>
    <div class="movie-info">
      <h3>${title}</h3>
      <span>⭐ ${item.vote_average.toFixed(1)}</span>
    </div>
  `;
  
  card.onclick = () => {
    currentType = item.type || 'movie';
    showDetails(item);
  };
  
  return card;
}

// Global functions for remove buttons
window.removeFromContinue = function(id) {
  removeFromContinueWatching(id);
  loadContinueWatching();
};

window.removeFromWatchlistUI = function(id) {
  removeFromWatchlist(id);
  loadWatchlist();
  
  // Update overlay if it's currently showing this item
  if (currentItemId === id) {
    updateWatchlistButtons();
  }
};

// Load default movies
load(`${BASE}/movie/popular?api_key=${API_KEY}`);

// Tab click logic
tabs.forEach(tab => {
  tab.onclick = () => {
    tabs.forEach(t => t.classList.remove("active"));
    tab.classList.add("active");
    
    const type = tab.dataset.type;
    
    if (type === 'continue') {
      showSection('continue');
    } else if (type === 'watchlist') {
      showSection('watchlist');
    } else {
      currentType = type;
      search.value = "";
      showSection('main');
      load(`${BASE}/${currentType}/popular?api_key=${API_KEY}`);
    }
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
    const card = createCard(item);
    grid.appendChild(card);
  });
}

// Update watchlist buttons in overlay
function updateWatchlistButtons() {
  const inWatchlist = isInWatchlist(currentItemId);
  
  if (inWatchlist) {
    addToWatchlistBtn.classList.add('hidden');
    removeFromWatchlistBtn.classList.remove('hidden');
  } else {
    addToWatchlistBtn.classList.remove('hidden');
    removeFromWatchlistBtn.classList.add('hidden');
  }
}

// Show details overlay
async function showDetails(item) {
  currentItemId = item.id;
  currentItem = item;
  
  overlayTitle.textContent = item.title || item.name;
  overlayDesc.textContent = item.overview || "No description available.";
  overlayRating.textContent = item.vote_average.toFixed(1);
  overlayDate.textContent = item.release_date || item.first_air_date || "N/A";
  overlayVotes.textContent = item.vote_count || 0;
  overlayPoster.src = IMG + item.poster_path;
  
  // Update watchlist buttons
  updateWatchlistButtons();
  
  if (currentType === "tv") {
    tvControls.classList.remove("hidden");
    await loadTVShowDetails(item.id);
  } else {
    tvControls.classList.add("hidden");
  }
  
  overlay.classList.remove("hidden");
}

// Load TV show details
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
    
    showEpisodeInfo(season, 1);
  } catch (err) {
    console.error("Failed to load episodes:", err);
    episodeSelect.innerHTML = "<option>Failed to load</option>";
  }
}

// Show episode info
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

// Season change
seasonSelect.onchange = async function() {
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
    showEpisodeInfo(season, 1);
  }
};

// Episode change
episodeSelect.onchange = function() {
  const season = parseInt(seasonSelect.value);
  const episode = parseInt(this.value);
  showEpisodeInfo(season, episode);
};

// Watchlist button handlers
addToWatchlistBtn.onclick = () => {
  if (addToWatchlist(currentItem)) {
    updateWatchlistButtons();
    
    // Show notification
    const notification = document.createElement('div');
    notification.className = 'notification';
    notification.textContent = '✓ Added to Watchlist';
    document.body.appendChild(notification);
    
    setTimeout(() => {
      notification.classList.add('show');
    }, 10);
    
    setTimeout(() => {
      notification.classList.remove('show');
      setTimeout(() => notification.remove(), 300);
    }, 2000);
  }
};

removeFromWatchlistBtn.onclick = () => {
  removeFromWatchlist(currentItemId);
  updateWatchlistButtons();
  
  // Show notification
  const notification = document.createElement('div');
  notification.className = 'notification';
  notification.textContent = '✓ Removed from Watchlist';
  document.body.appendChild(notification);
  
  setTimeout(() => {
    notification.classList.add('show');
  }, 10);
  
  setTimeout(() => {
    notification.classList.remove('show');
    setTimeout(() => notification.remove(), 300);
  }, 2000);
};

// Play button
playButton.onclick = () => {
  let playerUrl = `tvplayer.html?type=${currentType}&id=${currentItemId}`;
  
  let season = 1;
  let episode = 1;
  
  if (currentType === "tv") {
    season = seasonSelect.value || 1;
    episode = episodeSelect.value || 1;
    playerUrl += `&season=${season}&episode=${episode}`;
  }
  
  // Add to continue watching
  addToContinueWatching(currentItem, season, episode);
  
  window.location.href = playerUrl;
};

// Clear buttons
clearContinueBtn.onclick = clearContinueWatching;
clearWatchlistBtn.onclick = clearWatchlist;

// Close overlay
closeOverlay.onclick = () => overlay.classList.add("hidden");
overlay.onclick = e => {
  if (e.target === overlay) overlay.classList.add("hidden");
};
