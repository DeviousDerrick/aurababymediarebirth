import React, { useState, useEffect } from 'react';

const API_KEY = "72f0a0fa086259c4fc4b8bf0b856e446";
const BASE = "https://api.themoviedb.org/3";
const IMG = "https://image.tmdb.org/t/p/w500";

export default function AuraBabyMedia() {
  const [items, setItems] = useState([]);
  const [currentType, setCurrentType] = useState("movie");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedItem, setSelectedItem] = useState(null);
  const [showPlayer, setShowPlayer] = useState(false);
  const [season, setSeason] = useState(1);
  const [episode, setEpisode] = useState(1);

  useEffect(() => {
    loadContent(`${BASE}/${currentType}/popular?api_key=${API_KEY}`);
  }, [currentType]);

  useEffect(() => {
    if (searchQuery.trim()) {
      loadContent(`${BASE}/search/${currentType}?api_key=${API_KEY}&query=${encodeURIComponent(searchQuery)}`);
    } else {
      loadContent(`${BASE}/${currentType}/popular?api_key=${API_KEY}`);
    }
  }, [searchQuery]);

  async function loadContent(url) {
    try {
      const res = await fetch(url);
      const data = await res.json();
      setItems(data.results || []);
    } catch (err) {
      console.error("Failed to fetch:", err);
    }
  }

  function handlePlay(item) {
    setSelectedItem(item);
    setShowPlayer(true);
    setSeason(1);
    setEpisode(1);
  }

  function getPlayerUrl() {
    if (!selectedItem) return "";
    
    const id = selectedItem.id;
    let targetUrl = "";
    
    if (currentType === "movie") {
      targetUrl = `https://cinemaos.tech/movie/${id}`;
    } else {
      targetUrl = `https://cinemaos.tech/tv/${id}/${season}/${episode}`;
    }
    
    // Encode for Ocho proxy
    const encoded = btoa(targetUrl).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
    return `/ocho/${encoded}`;
  }

  return (
    <div className="min-h-screen bg-black text-white">
      {/* Header */}
      <header className="flex justify-between items-center px-6 py-4 bg-[#0a0a0a] border-b border-[#111]">
        <h1 className="text-2xl font-extrabold">
          AuraBaby <span className="text-[#7c7cff]" style={{textShadow: '0 0 12px rgba(124,124,255,0.6)'}}>Media</span>
        </h1>
        <input
          type="text"
          placeholder="Search..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="bg-[#111] border-none text-white px-4 py-2 rounded-lg w-56 outline-none"
        />
      </header>

      {/* Tabs */}
      <nav className="flex justify-center gap-4 bg-[#0a0a0a] py-3 border-b border-[#111]">
        <button
          onClick={() => setCurrentType("movie")}
          className={`px-4 py-2 rounded-lg font-bold transition-all ${
            currentType === "movie"
              ? "bg-[#7c7cff] text-black shadow-[0_0_12px_rgba(124,124,255,0.6)]"
              : "bg-[#111] text-white"
          }`}
        >
          Movies
        </button>
        <button
          onClick={() => setCurrentType("tv")}
          className={`px-4 py-2 rounded-lg font-bold transition-all ${
            currentType === "tv"
              ? "bg-[#7c7cff] text-black shadow-[0_0_12px_rgba(124,124,255,0.6)]"
              : "bg-[#111] text-white"
          }`}
        >
          Shows
        </button>
      </nav>

      {/* Movie/Show Grid */}
      {!showPlayer && (
        <main className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4 p-5">
          {items.filter(item => item.poster_path).map((item) => {
            const title = item.title || item.name;
            return (
              <div
                key={item.id}
                className="cursor-pointer transition-transform hover:scale-105 hover:shadow-[0_0_20px_rgba(124,124,255,0.25)]"
                onClick={() => setSelectedItem(item)}
              >
                <img
                  src={IMG + item.poster_path}
                  alt={title}
                  className="w-full block bg-black rounded-lg"
                />
                <div className="pt-2">
                  <h3 className="text-sm truncate">{title}</h3>
                  <span className="text-xs opacity-70">⭐ {item.vote_average}</span>
                </div>
              </div>
            );
          })}
        </main>
      )}

      {/* Detail Overlay */}
      {selectedItem && !showPlayer && (
        <div
          className="fixed inset-0 bg-black/90 flex items-center justify-center z-50"
          onClick={() => setSelectedItem(null)}
        >
          <div
            className="bg-[#111] p-6 max-w-4xl w-11/12 flex gap-6 rounded-xl relative"
            onClick={(e) => e.stopPropagation()}
          >
            <span
              className="absolute top-3 right-4 text-3xl cursor-pointer"
              onClick={() => setSelectedItem(null)}
            >
              &times;
            </span>
            
            <div className="flex-[2]">
              <h2 className="text-2xl font-bold mb-3">{selectedItem.title || selectedItem.name}</h2>
              <p className="mb-2">{selectedItem.overview || "No description available."}</p>
              <p className="mb-1"><strong>⭐ Rating:</strong> {selectedItem.vote_average}</p>
              <p className="mb-1"><strong>Release Date:</strong> {selectedItem.release_date || selectedItem.first_air_date || "N/A"}</p>
              <p className="mb-4"><strong>Votes:</strong> {selectedItem.vote_count || 0}</p>
              
              {currentType === "tv" && (
                <div className="flex gap-4 mb-4">
                  <div>
                    <label className="block text-sm mb-1">Season:</label>
                    <input
                      type="number"
                      min="1"
                      value={season}
                      onChange={(e) => setSeason(parseInt(e.target.value) || 1)}
                      className="bg-[#222] text-white px-3 py-2 rounded w-20"
                    />
                  </div>
                  <div>
                    <label className="block text-sm mb-1">Episode:</label>
                    <input
                      type="number"
                      min="1"
                      value={episode}
                      onChange={(e) => setEpisode(parseInt(e.target.value) || 1)}
                      className="bg-[#222] text-white px-3 py-2 rounded w-20"
                    />
                  </div>
                </div>
              )}
              
              <button
                onClick={() => handlePlay(selectedItem)}
                className="bg-[#7c7cff] text-black px-8 py-3 rounded-lg font-bold text-lg hover:bg-[#6b6bef] transition-colors shadow-[0_0_12px_rgba(124,124,255,0.6)]"
              >
                ▶ Play {currentType === "tv" ? `S${season}E${episode}` : ""}
              </button>
            </div>
            
            <div className="flex-1">
              <img
                src={IMG + selectedItem.poster_path}
                alt={selectedItem.title || selectedItem.name}
                className="w-full rounded-lg"
              />
            </div>
          </div>
        </div>
      )}

      {/* Player */}
      {showPlayer && selectedItem && (
        <div className="fixed inset-0 bg-black z-50 flex flex-col">
          <div className="bg-[#0a0a0a] px-4 py-3 flex justify-between items-center border-b border-[#111]">
            <h2 className="text-lg font-bold">
              {selectedItem.title || selectedItem.name}
              {currentType === "tv" && ` - S${season}E${episode}`}
            </h2>
            <button
              onClick={() => setShowPlayer(false)}
              className="text-2xl hover:text-[#7c7cff] transition-colors"
            >
              &times;
            </button>
          </div>
          
          {currentType === "tv" && (
            <div className="bg-[#0a0a0a] px-4 py-2 flex gap-4 border-b border-[#111]">
              <div className="flex items-center gap-2">
                <label className="text-sm">Season:</label>
                <input
                  type="number"
                  min="1"
                  value={season}
                  onChange={(e) => setSeason(parseInt(e.target.value) || 1)}
                  className="bg-[#222] text-white px-2 py-1 rounded w-16 text-sm"
                />
              </div>
              <div className="flex items-center gap-2">
                <label className="text-sm">Episode:</label>
                <input
                  type="number"
                  min="1"
                  value={episode}
                  onChange={(e) => setEpisode(parseInt(e.target.value) || 1)}
                  className="bg-[#222] text-white px-2 py-1 rounded w-16 text-sm"
                />
              </div>
              <button
                onClick={() => {
                  // Force iframe reload by updating key
                  const iframe = document.querySelector('#player-iframe');
                  if (iframe) iframe.src = getPlayerUrl();
                }}
                className="bg-[#7c7cff] text-black px-4 py-1 rounded text-sm font-bold hover:bg-[#6b6bef] transition-colors"
              >
                Load Episode
              </button>
            </div>
          )}
          
          <iframe
            id="player-iframe"
            src={getPlayerUrl()}
            className="flex-1 w-full border-none"
            allowFullScreen
            allow="autoplay; fullscreen; picture-in-picture"
          />
        </div>
      )}
    </div>
  );
}
