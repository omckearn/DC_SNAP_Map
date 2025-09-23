// public token restricted to https://omckearn.github.io/DC_SNAP_Map/*
mapboxgl.accessToken = "pk.eyJ1Ijoib21ja2Vhcm51dyIsImEiOiJjbWZ2cWNyYWcwNWRoMmtwdWc5amk1bWxiIn0.5uwt4drO_Ej32d0C_qqOwQ";

const map = new mapboxgl.Map({
  container: 'map',
  style: 'mapbox://styles/mapbox/streets-v12',
  center: [-77.0369, 38.9072], // DC center
  zoom: 11
});

// Add basic navigation (zoom/rotate) controls to top-left, then move into panel
const _navControl = new mapboxgl.NavigationControl({ visualizePitch: true });
map.addControl(_navControl, 'top-left');

// Emoji icons for each store type
const storeTypeIcons = {
  'Convenience Store': '🏪',
  'Farmers and Markets': '🥦',
  'Grocery Store': '🛒',
  'Other': '📍',
  'Pharmacy': '💊',
  'Specialty Store': '🧀',
  'Super Store': '🛍️',
  'Supermarket': '🛒'
};

// Colors per store type for markers + legend
const storeTypeColors = {
  'Convenience Store': '#1f77b4',
  'Farmers and Markets': '#2ca02c',
  'Grocery Store': '#ff7f0e',
  'Other': '#9467bd',
  'Pharmacy': '#d62728',
  'Specialty Store': '#8c564b',
  'Super Store': '#17becf',
  'Supermarket': '#e377c2'
};

// Add an empty GeoJSON source + layer for selected ward outline once map style loads
map.on('load', () => {
  // Add mask source/layer to dim areas outside DC
  if (!map.getSource('dc-mask')) {
    map.addSource('dc-mask', {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] }
    });
  }
  if (!map.getLayer('dc-mask')) {
    map.addLayer({
      id: 'dc-mask',
      type: 'fill',
      source: 'dc-mask',
      paint: {
        'fill-color': '#000000',
        'fill-opacity': 0.2
      }
    });
  }
  // Add DC boundary line source/layer (solid outline)
  if (!map.getSource('dc-boundary-line')) {
    map.addSource('dc-boundary-line', {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] }
    });
  }
  if (!map.getLayer('dc-boundary-outline')) {
    map.addLayer({
      id: 'dc-boundary-outline',
      type: 'line',
      source: 'dc-boundary-line',
      layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint: {
        'line-color': '#000000',
        'line-width': 5,
        'line-opacity': 1,
        'line-blur': 0
      }
    });
  }
  // Ensure boundary line is on top of style layers
  if (map.getLayer('dc-boundary-outline')) {
    try { map.moveLayer('dc-boundary-outline'); } catch (_) {}
  }
  if (!map.getSource('selected-ward')) {
    map.addSource('selected-ward', {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] }
    });
  }
  if (!map.getLayer('selected-ward-fill')) {
    map.addLayer({
      id: 'selected-ward-fill',
      type: 'fill',
      source: 'selected-ward',
      paint: {
        'fill-color': '#000000',
        'fill-opacity': 0.05,        // faint fill so outline is ensured
        'fill-outline-color': '#000' // fallback outline
      }
    });
  }
  // Separate line source/layer for a crisp outline
  if (!map.getSource('selected-ward-line')) {
    map.addSource('selected-ward-line', {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] }
    });
  }
  if (!map.getLayer('selected-ward-outline')) {
    map.addLayer({
      id: 'selected-ward-outline',
      type: 'line',
      source: 'selected-ward-line',
      layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint: {
        'line-color': '#000',
        'line-width': 2.5,
        'line-opacity': 1
      }
    });
  }
  
  // User location source/layer (blue circle with white outline)
  if (!map.getSource('user-location')) {
    map.addSource('user-location', {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] }
    });
  }
  if (!map.getLayer('user-location-dot')) {
    map.addLayer({
      id: 'user-location-dot',
      type: 'circle',
      source: 'user-location',
      paint: {
        'circle-radius': 7,
        'circle-color': '#1f6feb',
        'circle-stroke-color': '#ffffff',
        'circle-stroke-width': 2,
        'circle-opacity': 1
      }
    });
  }
  // Try to get current position and watch for updates
  if (navigator.geolocation) {
    const opts = { enableHighAccuracy: true, maximumAge: 10000, timeout: 10000 };
    navigator.geolocation.getCurrentPosition(
      (pos) => updateUserLocation(pos.coords.longitude, pos.coords.latitude),
      (err) => console.warn('Geolocation error (initial):', err),
      opts
    );
    navigator.geolocation.watchPosition(
      (pos) => updateUserLocation(pos.coords.longitude, pos.coords.latitude),
      (err) => console.warn('Geolocation error (watch):', err),
      opts
    );
  }
  // If boundary already loaded, update mask and bounds now
  updateDCMaskAndBounds();
  // Retailer source/layers for clustering/points (default aggregation OFF)
  applyAggregationSetting();
  // Wire aggregation toggle
  try {
    const agg = document.getElementById('aggToggle');
    if (agg) {
      agg.checked = !!clusterEnabled;
      agg.addEventListener('change', () => {
        clusterEnabled = !!agg.checked;
        applyAggregationSetting();
      });
    }
  } catch (_) {}
  // Move nav controls into dock just below filters
  try {
    const corner = map.getContainer().querySelector('.mapboxgl-ctrl-top-left');
    const target = document.getElementById('mapNavDock');
    if (corner && target) {
      const group = corner.querySelector('.mapboxgl-ctrl-group');
      if (group) target.appendChild(group);
    }
    repositionNavDock();
  } catch (_) {}
  // Reposition nav dock on resize
  window.addEventListener('resize', repositionNavDock);

  // Map click to pick a location (when enabled)
  map.on('click', (e) => {
    if (!pickLocationMode) return;
    setNearLocation(e.lngLat.lng, e.lngLat.lat, true, 'pick');
    togglePickMode(false);
  });

  // Show intro modal for first-time users
  try {
    const dismissed = localStorage.getItem('introDismissed') === 'true';
    if (!dismissed) showIntroModal();
  } catch (_) { showIntroModal(); }
});

let geojsonData;
let wardsData;
let wardsById = {};
let selectedWards = new Set();
let countiesData;
let countiesById = {};
let selectedCounties = new Set();
let markers = [];
let dcBoundaryGeom = null; // raw GeoJSON geometry for DC boundary
let dcPolygon = null;      // Turf.js polygon/multipolygon for DC boundary
let dcBoundsApplied = false; // track whether we've fit/limited to DC bounds
let dcBounds = null;       // saved DC bounds for Home button
let currentFilteredData = null; // currently filtered FeatureCollection
let nearLocation = null;   // { lon, lat } chosen by user
let pickLocationMode = false; // whether map clicks set near location
let currentGeo = { lon: null, lat: null }; // last known geolocation
let nearMarker = null; // Marker for user-input location (search/pick)
let distanceUnits = 'miles'; // miles | kilometers
let clusterEnabled = false; // aggregation (clustering) toggle; default OFF
let borderRetailersData = null; // bordering counties retailers dataset
let showBorderRetailers = false; // toggle for including bordering retailers

// Build/rebuild the retailers source and layers according to clusterEnabled
function rebuildRetailerLayers() {
  try {
    // Remove existing layers if present
    ['retailers-icons', 'retailers-circles', 'cluster-count', 'clusters'].forEach((ly) => {
      if (map.getLayer(ly)) {
        try { map.removeLayer(ly); } catch (_) {}
      }
    });
    // Remove source if present
    if (map.getSource('retailers')) {
      try { map.removeSource('retailers'); } catch (_) {}
    }

    // Current data (filtered if available)
    const data = (currentFilteredData || geojsonData) || { type: 'FeatureCollection', features: [] };

    // Add source with clustering per toggle
    map.addSource('retailers', {
      type: 'geojson',
      data,
      cluster: !!clusterEnabled,
      clusterRadius: 45,
      clusterMaxZoom: 14
    });

    // Cluster layers (will be empty when clusterEnabled is false)
    map.addLayer({
      id: 'clusters',
      type: 'circle',
      source: 'retailers',
      filter: ['has', 'point_count'],
      paint: {
        'circle-color': '#033C5A',
        'circle-radius': ['step', ['get', 'point_count'], 16, 10, 20, 25, 24],
        'circle-stroke-color': '#ffffff',
        'circle-stroke-width': 2
      }
    });
    map.addLayer({
      id: 'cluster-count',
      type: 'symbol',
      source: 'retailers',
      filter: ['has', 'point_count'],
      layout: { 'text-field': ['get', 'point_count_abbreviated'], 'text-size': 12 },
      paint: { 'text-color': '#ffffff' }
    });

    // Non-cluster point layers (show when not clustered at current zoom, or always when cluster disabled)
    map.addLayer({
      id: 'retailers-circles',
      type: 'circle',
      source: 'retailers',
      filter: ['!', ['has', 'point_count']],
      paint: {
        'circle-radius': 14,
        'circle-color': [
          'match', ['get', 'Store_Type'],
          'Convenience Store', '#1f77b4',
          'Farmers and Markets', '#2ca02c',
          'Grocery Store', '#ff7f0e',
          'Pharmacy', '#d62728',
          'Specialty Store', '#8c564b',
          'Super Store', '#17becf',
          'Supermarket', '#e377c2',
          /* other */ '#9467bd'
        ],
        'circle-stroke-color': '#ffffff',
        'circle-stroke-width': 2
      }
    });
    // Register emoji images and overlay them as icons above circles
    registerEmojiIconImages();
    map.addLayer({
      id: 'retailers-icons',
      type: 'symbol',
      source: 'retailers',
      filter: ['!', ['has', 'point_count']],
      layout: {
        'icon-image': [
          'match', ['get', 'Store_Type'],
          'Convenience Store', 'st_emoji_convenience_store',
          'Farmers and Markets', 'st_emoji_farmers_and_markets',
          'Grocery Store', 'st_emoji_grocery_store',
          'Pharmacy', 'st_emoji_pharmacy',
          'Specialty Store', 'st_emoji_specialty_store',
          'Super Store', 'st_emoji_super_store',
          'Supermarket', 'st_emoji_supermarket',
          /* other */ 'st_emoji_other'
        ],
        'icon-size': 0.9,
        'icon-allow-overlap': true,
        'icon-anchor': 'center'
      }
    });

    // Bind interactivity once
    if (!map.__retailerHandlersBound) {
      map.on('click', 'clusters', (e) => {
        const features = map.queryRenderedFeatures(e.point, { layers: ['clusters'] });
        const clusterId = features[0].properties.cluster_id;
        const source = map.getSource('retailers');
        source.getClusterExpansionZoom(clusterId, (err, zoom) => {
          if (err) return;
          map.easeTo({ center: features[0].geometry.coordinates, zoom });
        });
      });
      map.on('mouseenter', 'clusters', () => { map.getCanvas().style.cursor = 'pointer'; });
      map.on('mouseleave', 'clusters', () => { map.getCanvas().style.cursor = ''; });

      const pointLayers = ['retailers-circles', 'retailers-icons'];
      pointLayers.forEach((ly) => {
        map.on('mouseenter', ly, () => { map.getCanvas().style.cursor = 'pointer'; });
        map.on('mouseleave', ly, () => { map.getCanvas().style.cursor = ''; });
        map.on('click', ly, (e) => {
          const f = e.features && e.features[0];
          if (!f) return;
          const props = f.properties || {};
          const coords = f.geometry.coordinates.slice();
          const addressParts = [
            props.Store_Street_Address,
            props.Additonal_Address,
            [props.City, props.State].filter(Boolean).join(', '),
            props.Zip_Code
          ].filter(Boolean);
          const addressLine = addressParts.join(', ');
          const html = `
            <div>
              <strong>${props.Store_Name || 'Unnamed Store'}</strong><br>
              <span>${props.Store_Type || 'Unknown Type'}</span><br>
              <span>
                ${addressLine || 'Address not available'}
                ${addressLine ? '<button class=\"copy-address-btn\" type=\"button\" title=\"Copy\" aria-label=\"Copy\">📋</button>' : ''}
              </span>
              <div style=\"margin-top:6px;\">
                <a class=\"near-dir popup-dir\" href=\"#\" target=\"_blank\" rel=\"noopener\">Directions</a>
              </div>
            </div>`;
          const popup = new mapboxgl.Popup({ offset: 20, className: 'app-popup' }).setLngLat(coords).setHTML(html).addTo(map);

          popup.on('open', () => {
            try {
              const container = popup.getElement();
              const btn = container && container.querySelector('.copy-address-btn');
              if (btn) {
                btn.addEventListener('click', (ev) => {
                  ev.stopPropagation();
                  if (!addressLine) return;
                  if (navigator.clipboard && navigator.clipboard.writeText) {
                    navigator.clipboard.writeText(addressLine)
                      .then(() => { btn.textContent = '✅'; setTimeout(() => { btn.textContent = '📋'; }, 1200); })
                      .catch(() => { btn.textContent = '❌'; setTimeout(() => { btn.textContent = '📋'; }, 1200); });
                  } else {
                    const ta = document.createElement('textarea');
                    ta.value = addressLine; document.body.appendChild(ta); ta.select();
                    try { document.execCommand('copy'); btn.textContent = '✅'; } catch(_) { btn.textContent = '❌'; }
                    document.body.removeChild(ta); setTimeout(() => { btn.textContent = '📋'; }, 1200);
                  }
                }, { once: true });
              }
            } catch (_) {}

            try {
              const container = popup.getElement();
              const dir = container && container.querySelector('.popup-dir');
              if (dir) {
                const hasGeo = currentGeo && currentGeo.lon != null && currentGeo.lat != null;
                const destLat = coords[1], destLon = coords[0];
                if (hasGeo) {
                  const originStr = `${currentGeo.lat},${currentGeo.lon}`;
                  const destStr = `${destLat},${destLon}`;
                  dir.href = `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(originStr)}&destination=${encodeURIComponent(destStr)}&travelmode=walking`;
                } else {
                  const destStr = `${destLat},${destLon}`;
                  dir.href = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(destStr)}`;
                }
              }
            } catch (_) {}
          });
        });
      });

      map.__retailerHandlersBound = true;
    }
  } catch (e) {
    console.error('Failed to rebuild retailer layers:', e);
  }
}

// Same as rebuildRetailerLayers, but with cleaned popup HTML quoting
function applyAggregationSetting() {
  try {
    ['retailers-icons', 'retailers-circles', 'cluster-count', 'clusters'].forEach((ly) => {
      if (map.getLayer(ly)) {
        try { map.removeLayer(ly); } catch (_) {}
      }
    });
    if (map.getSource('retailers')) {
      try { map.removeSource('retailers'); } catch (_) {}
    }

    const data = (currentFilteredData || geojsonData) || { type: 'FeatureCollection', features: [] };
    map.addSource('retailers', {
      type: 'geojson',
      data,
      cluster: !!clusterEnabled,
      clusterRadius: 45,
      clusterMaxZoom: 14
    });

    map.addLayer({
      id: 'clusters',
      type: 'circle',
      source: 'retailers',
      filter: ['has', 'point_count'],
      paint: {
        'circle-color': '#033C5A',
        'circle-radius': ['step', ['get', 'point_count'], 16, 10, 20, 25, 24],
        'circle-stroke-color': '#ffffff',
        'circle-stroke-width': 2
      }
    });
    map.addLayer({
      id: 'cluster-count',
      type: 'symbol',
      source: 'retailers',
      filter: ['has', 'point_count'],
      layout: { 'text-field': ['get', 'point_count_abbreviated'], 'text-size': 12 },
      paint: { 'text-color': '#ffffff' }
    });

    map.addLayer({
      id: 'retailers-circles',
      type: 'circle',
      source: 'retailers',
      filter: ['!', ['has', 'point_count']],
      paint: {
        'circle-radius': 14,
        'circle-color': [
          'match', ['get', 'Store_Type'],
          'Convenience Store', '#1f77b4',
          'Farmers and Markets', '#2ca02c',
          'Grocery Store', '#ff7f0e',
          'Pharmacy', '#d62728',
          'Specialty Store', '#8c564b',
          'Super Store', '#17becf',
          'Supermarket', '#e377c2',
          /* other */ '#9467bd'
        ],
        'circle-stroke-color': '#ffffff',
        'circle-stroke-width': 2
      }
    });
    registerEmojiIconImages();
    map.addLayer({
      id: 'retailers-icons',
      type: 'symbol',
      source: 'retailers',
      filter: ['!', ['has', 'point_count']],
      layout: {
        'icon-image': [
          'match', ['get', 'Store_Type'],
          'Convenience Store', 'st_emoji_convenience_store',
          'Farmers and Markets', 'st_emoji_farmers_and_markets',
          'Grocery Store', 'st_emoji_grocery_store',
          'Pharmacy', 'st_emoji_pharmacy',
          'Specialty Store', 'st_emoji_specialty_store',
          'Super Store', 'st_emoji_super_store',
          'Supermarket', 'st_emoji_supermarket',
          /* other */ 'st_emoji_other'
        ],
        'icon-size': 0.9,
        'icon-allow-overlap': true,
        'icon-anchor': 'center'
      }
    });

    if (!map.__retailerHandlersBound) {
      map.on('click', 'clusters', (e) => {
        const features = map.queryRenderedFeatures(e.point, { layers: ['clusters'] });
        const clusterId = features[0].properties.cluster_id;
        const source = map.getSource('retailers');
        source.getClusterExpansionZoom(clusterId, (err, zoom) => {
          if (err) return;
          map.easeTo({ center: features[0].geometry.coordinates, zoom });
        });
      });
      map.on('mouseenter', 'clusters', () => { map.getCanvas().style.cursor = 'pointer'; });
      map.on('mouseleave', 'clusters', () => { map.getCanvas().style.cursor = ''; });

      const pointLayers = ['retailers-circles', 'retailers-icons'];
      pointLayers.forEach((ly) => {
        map.on('mouseenter', ly, () => { map.getCanvas().style.cursor = 'pointer'; });
        map.on('mouseleave', ly, () => { map.getCanvas().style.cursor = ''; });
        map.on('click', ly, (e) => {
          const f = e.features && e.features[0];
          if (!f) return;
          const props = f.properties || {};
          const coords = f.geometry.coordinates.slice();
          const addressParts = [
            props.Store_Street_Address,
            props.Additonal_Address,
            [props.City, props.State].filter(Boolean).join(', '),
            props.Zip_Code
          ].filter(Boolean);
          const addressLine = addressParts.join(', ');
          const html = `
            <div>
              <strong>${props.Store_Name || 'Unnamed Store'}</strong><br>
              <span>${props.Store_Type || 'Unknown Type'}</span><br>
              <span>
                ${addressLine || 'Address not available'}
                ${addressLine ? '<button class="copy-address-btn" type="button" title="Copy" aria-label="Copy">📋</button>' : ''}
              </span>
              <div style="margin-top:6px;">
                <a class="near-dir popup-dir" href="#" target="_blank" rel="noopener">Directions</a>
              </div>
            </div>`;
          const popup = new mapboxgl.Popup({ offset: 20, className: 'app-popup' }).setLngLat(coords).setHTML(html).addTo(map);

          popup.on('open', () => {
            try {
              const container = popup.getElement();
              const btn = container && container.querySelector('.copy-address-btn');
              if (btn) {
                btn.addEventListener('click', (ev) => {
                  ev.stopPropagation();
                  if (!addressLine) return;
                  if (navigator.clipboard && navigator.clipboard.writeText) {
                    navigator.clipboard.writeText(addressLine)
                      .then(() => { btn.textContent = '✅'; setTimeout(() => { btn.textContent = '📋'; }, 1200); })
                      .catch(() => { btn.textContent = '❌'; setTimeout(() => { btn.textContent = '📋'; }, 1200); });
                  } else {
                    const ta = document.createElement('textarea');
                    ta.value = addressLine; document.body.appendChild(ta); ta.select();
                    try { document.execCommand('copy'); btn.textContent = '✅'; } catch(_) { btn.textContent = '❌'; }
                    document.body.removeChild(ta); setTimeout(() => { btn.textContent = '📋'; }, 1200);
                  }
                }, { once: true });
              }
            } catch (_) {}

            try {
              const container = popup.getElement();
              const dir = container && container.querySelector('.popup-dir');
              if (dir) {
                const hasGeo = currentGeo && currentGeo.lon != null && currentGeo.lat != null;
                const destLat = coords[1], destLon = coords[0];
                if (hasGeo) {
                  const originStr = `${currentGeo.lat},${currentGeo.lon}`;
                  const destStr = `${destLat},${destLon}`;
                  dir.href = `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(originStr)}&destination=${encodeURIComponent(destStr)}&travelmode=walking`;
                } else {
                  const destStr = `${destLat},${destLon}`;
                  dir.href = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(destStr)}`;
                }
              }
            } catch (_) {}
          });
        });
      });

      map.__retailerHandlersBound = true;
    }
  } catch (e) {
    console.error('Failed to apply aggregation setting:', e);
  }
}

function getSelectedStoreTypes() {
  const container = document.getElementById('storeTypeFilters');
  if (!container) return new Set();
  const checked = container.querySelectorAll('input[type="checkbox"]:checked');
  const types = new Set();
  checked.forEach((el) => types.add(el.value));
  return types;
}

// Utilities to provide emoji icons via images (ensures emoji render reliably)
function slugStoreType(type) {
  return String(type || 'other').toLowerCase().replace(/[^a-z0-9]+/g, '_');
}

// Register an emoji as a sprite image using a data URL (more reliable than ImageData on some browsers)
function addEmojiImage(name, emojiChar) {
  if (map.hasImage && map.hasImage(name)) return;
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size; canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.clearRect(0, 0, size, size);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = '48px "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", system-ui, sans-serif';
  ctx.fillText(emojiChar, size/2, size/2);
  const url = canvas.toDataURL('image/png');
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.onload = () => {
    try { map.addImage(name, img, { pixelRatio: 2 }); } catch (_) {}
  };
  img.src = url;
}

function registerEmojiIconImages() {
  const entries = Object.entries(storeTypeIcons);
  entries.forEach(([type, emoji]) => {
    const name = `st_emoji_${slugStoreType(type)}`;
    addEmojiImage(name, emoji);
  });
  // Fallback for missing types
  addEmojiImage('st_emoji_other', '📍');
  // Add on-demand hook for any style re-requests
  if (!map.__emojiMissingHook) {
    map.on('styleimagemissing', (e) => {
      const id = e && e.id;
      if (id && /^st_emoji_/.test(id)) {
        // Derive emoji from name if possible, else use 📍
        const slug = id.replace(/^st_emoji_/, '');
        const match = Object.entries(storeTypeIcons).find(([t]) => slugStoreType(t) === slug);
        const emoji = match ? match[1] : '📍';
        addEmojiImage(id, emoji);
      }
    });
    map.__emojiMissingHook = true;
  }
}

// Position the nav dock just below the filters panel
function repositionNavDock() {
  const dock = document.getElementById('mapNavDock');
  const near = document.getElementById('near-panel');
  if (!dock || !near) return;
  const r = near.getBoundingClientRect();
  // Place the dock just below Near Me, aligned to the right edge
  dock.style.left = 'auto';
  dock.style.right = '10px';
  dock.style.top = `${Math.round(r.bottom) + 8}px`;
}

// Intro modal controls
function showIntroModal() {
  const modal = document.getElementById('introModal');
  const got = document.getElementById('introGotIt');
  const close = document.getElementById('introClose');
  const dont = document.getElementById('introDontShow');
  if (!modal) return;
  modal.style.display = 'flex';
  const hide = () => {
    if (dont && dont.checked) {
      try { localStorage.setItem('introDismissed', 'true'); } catch (_) {}
    }
    modal.style.display = 'none';
  };
  if (got) got.onclick = hide;
  if (close) close.onclick = hide;
}

// Utility to clear markers
function clearMarkers() {
  markers.forEach(m => m.remove());
  markers = [];
}

// Clustered retailer source/layers and popup behavior
function ensureRetailerLayers() {
  if (map.getSource('retailers')) return;
  map.addSource('retailers', {
    type: 'geojson',
    data: { type: 'FeatureCollection', features: [] },
    cluster: true,
    clusterRadius: 45,
    clusterMaxZoom: 14
  });

  map.addLayer({
    id: 'clusters',
    type: 'circle',
    source: 'retailers',
    filter: ['has', 'point_count'],
    paint: {
      'circle-color': '#033C5A',
      'circle-radius': ['step', ['get', 'point_count'], 16, 10, 20, 25, 24],
      'circle-stroke-color': '#ffffff',
      'circle-stroke-width': 2
    }
  });
  map.addLayer({
    id: 'cluster-count',
    type: 'symbol',
    source: 'retailers',
    filter: ['has', 'point_count'],
    layout: { 'text-field': ['get', 'point_count_abbreviated'], 'text-size': 12 },
    paint: { 'text-color': '#ffffff' }
  });

  map.addLayer({
    id: 'retailers-circles',
    type: 'circle',
    source: 'retailers',
    filter: ['!', ['has', 'point_count']],
    paint: {
      'circle-radius': 14,
      'circle-color': [
        'match', ['get', 'Store_Type'],
        'Convenience Store', '#1f77b4',
        'Farmers and Markets', '#2ca02c',
        'Grocery Store', '#ff7f0e',
        'Pharmacy', '#d62728',
        'Specialty Store', '#8c564b',
        'Super Store', '#17becf',
        'Supermarket', '#e377c2',
        /* other */ '#9467bd'
      ],
      'circle-stroke-color': '#ffffff',
      'circle-stroke-width': 2
    }
  });
  // Register emoji images and overlay them as icons above circles
  registerEmojiIconImages();
  map.addLayer({
    id: 'retailers-icons',
    type: 'symbol',
    source: 'retailers',
    filter: ['!', ['has', 'point_count']],
    layout: {
      'icon-image': [
        'match', ['get', 'Store_Type'],
        'Convenience Store', 'st_emoji_convenience_store',
        'Farmers and Markets', 'st_emoji_farmers_and_markets',
        'Grocery Store', 'st_emoji_grocery_store',
        'Pharmacy', 'st_emoji_pharmacy',
        'Specialty Store', 'st_emoji_specialty_store',
        'Super Store', 'st_emoji_super_store',
        'Supermarket', 'st_emoji_supermarket',
        /* other */ 'st_emoji_other'
      ],
      'icon-size': 0.9,
      'icon-allow-overlap': true,
      'icon-anchor': 'center'
    }
  });

  // Cluster interactivity
  map.on('click', 'clusters', (e) => {
    const features = map.queryRenderedFeatures(e.point, { layers: ['clusters'] });
    const clusterId = features[0].properties.cluster_id;
    const source = map.getSource('retailers');
    source.getClusterExpansionZoom(clusterId, (err, zoom) => {
      if (err) return;
      map.easeTo({ center: features[0].geometry.coordinates, zoom });
    });
  });
  map.on('mouseenter', 'clusters', () => { map.getCanvas().style.cursor = 'pointer'; });
  map.on('mouseleave', 'clusters', () => { map.getCanvas().style.cursor = ''; });

  const pointLayers = ['retailers-circles', 'retailers-icons'];
  pointLayers.forEach((ly) => {
    map.on('mouseenter', ly, () => { map.getCanvas().style.cursor = 'pointer'; });
    map.on('mouseleave', ly, () => { map.getCanvas().style.cursor = ''; });
    map.on('click', ly, (e) => {
      const f = e.features && e.features[0];
      if (!f) return;
      const props = f.properties || {};
      const coords = f.geometry.coordinates.slice();
      const addressParts = [
        props.Store_Street_Address,
        props.Additonal_Address,
        [props.City, props.State].filter(Boolean).join(', '),
        props.Zip_Code
      ].filter(Boolean);
      const addressLine = addressParts.join(', ');
      const html = `
        <div>
          <strong>${props.Store_Name || 'Unnamed Store'}</strong><br>
          <span>${props.Store_Type || 'Unknown Type'}</span><br>
          <span>
            ${addressLine || 'Address not available'}
            ${addressLine ? '<button class="copy-address-btn" type="button" title="Copy" aria-label="Copy">📋</button>' : ''}
          </span>
          <div style="margin-top:6px;">
            <a class="near-dir popup-dir" href="#" target="_blank" rel="noopener">Directions</a>
          </div>
        </div>`;
      const popup = new mapboxgl.Popup({ offset: 20, className: 'app-popup' }).setLngLat(coords).setHTML(html).addTo(map);

      popup.on('open', () => {
        try {
          const container = popup.getElement();
          const btn = container && container.querySelector('.copy-address-btn');
          if (btn) {
            btn.addEventListener('click', (ev) => {
              ev.stopPropagation();
              if (!addressLine) return;
              if (navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(addressLine)
                  .then(() => { btn.textContent = '✅'; setTimeout(() => { btn.textContent = '📋'; }, 1200); })
                  .catch(() => { btn.textContent = '❌'; setTimeout(() => { btn.textContent = '📋'; }, 1200); });
              } else {
                const ta = document.createElement('textarea');
                ta.value = addressLine; document.body.appendChild(ta); ta.select();
                try { document.execCommand('copy'); btn.textContent = '✅'; } catch(_) { btn.textContent = '❌'; }
                document.body.removeChild(ta); setTimeout(() => { btn.textContent = '📋'; }, 1200);
              }
            }, { once: true });
          }
        } catch (_) {}

        try {
          const container = popup.getElement();
          const dir = container && container.querySelector('.popup-dir');
          if (dir) {
            const hasGeo = currentGeo && currentGeo.lon != null && currentGeo.lat != null;
            const destLat = coords[1], destLon = coords[0];
            if (hasGeo) {
              const originStr = `${currentGeo.lat},${currentGeo.lon}`;
              const destStr = `${destLat},${destLon}`;
              dir.href = `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(originStr)}&destination=${encodeURIComponent(destStr)}&travelmode=walking`;
            } else {
              const destStr = `${destLat},${destLon}`;
              dir.href = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(destStr)}`;
            }
          }
        } catch (_) {}
      });
    });
  });
}

function updateRetailerSource(collection) {
  const src = map.getSource('retailers');
  if (!src) return;
  src.setData(collection || { type: 'FeatureCollection', features: [] });
}
// Add markers to map
function addMarkers(data) {
  data.features.forEach(feature => {
    const coords = feature.geometry.coordinates;
    const props = feature.properties;

    const addressParts = [
      props.Store_Street_Address,
      props.Additonal_Address,
      [props.City, props.State].filter(Boolean).join(', '),
      props.Zip_Code
    ].filter(Boolean);
    const addressLine = addressParts.join(', ');

    const popup = new mapboxgl.Popup({ offset: 20, className: 'app-popup' }).setHTML(`
      <div>
        <strong>${props.Store_Name || 'Unnamed Store'}</strong><br>
        <span>${props.Store_Type || 'Unknown Type'}</span><br>
        <span>
          ${addressLine || 'Address not available'}
          ${addressLine ? '<button class="copy-address-btn" type="button" title="Copy" aria-label="Copy">📋</button>' : ''}
        </span>
        <div style="margin-top:6px;">
          <a class="near-dir popup-dir" href="#" target="_blank" rel="noopener">Directions</a>
        </div>
      </div>
    `);

    const emoji = storeTypeIcons[props.Store_Type] || storeTypeIcons['Other'];
    const el = document.createElement('div');
    el.className = 'marker-emoji';
    el.textContent = emoji;
    el.setAttribute('title', props.Store_Name || 'Store');
    el.setAttribute('aria-label', props.Store_Name || 'Store');
    // Apply colored background by store type
    const color = storeTypeColors[props.Store_Type] || storeTypeColors['Other'];
    el.style.backgroundColor = color;

    const marker = new mapboxgl.Marker({ element: el, anchor: 'bottom' })
      .setLngLat(coords)
      .setPopup(popup)
      .addTo(map);

    // Wire up copy-to-clipboard when popup opens
    popup.on('open', () => {
      try {
        const container = popup.getElement();
        const btn = container && container.querySelector('.copy-address-btn');
        if (btn) {
          btn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (!addressLine) return;
            if (navigator.clipboard && navigator.clipboard.writeText) {
              navigator.clipboard.writeText(addressLine)
                .then(() => {
                  btn.textContent = '✅';
                  setTimeout(() => { btn.textContent = '📋'; }, 1200);
                })
                .catch(() => {
                  btn.textContent = '❌';
                  setTimeout(() => { btn.textContent = '📋'; }, 1200);
                });
            } else {
              // Fallback
              const ta = document.createElement('textarea');
              ta.value = addressLine;
              document.body.appendChild(ta);
              ta.select();
              try { document.execCommand('copy'); btn.textContent = '✅'; }
              catch (_) { btn.textContent = '❌'; }
              document.body.removeChild(ta);
              setTimeout(() => { btn.textContent = '📋'; }, 1200);
            }
          }, { once: true });
        }
      } catch (_) {}

      // Set directions link based on current geolocation if available
      try {
        const container = popup.getElement();
        const dir = container && container.querySelector('.popup-dir');
        if (dir) {
          const hasGeo = currentGeo && currentGeo.lon != null && currentGeo.lat != null;
          const destLat = coords[1];
          const destLon = coords[0];
          if (hasGeo) {
            const originStr = `${currentGeo.lat},${currentGeo.lon}`;
            const destStr = `${destLat},${destLon}`;
            dir.href = `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(originStr)}&destination=${encodeURIComponent(destStr)}&travelmode=walking`;
          } else {
            // Fallback: open destination location only
            const destStr = `${destLat},${destLon}`;
            dir.href = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(destStr)}`;
          }
        }
      } catch (_) {}
    });

    markers.push(marker);
  });
}

// Compute nearest retailer per store type and render list
function updateNearMePanel(collection) {
  const listEl = document.getElementById('nearList');
  const hintEl = document.getElementById('nearHint');
  if (!listEl) return;
  if (!nearLocation || !collection || !collection.features || !window.turf) {
    listEl.innerHTML = '';
    if (hintEl) hintEl.style.display = pickLocationMode ? 'block' : 'none';
    return;
  }

  const origin = turf.point([nearLocation.lon, nearLocation.lat]);
  const byType = new Map();
  collection.features.forEach(f => {
    const t = (f.properties && f.properties.Store_Type) || 'Other';
    // Skip categories that should not be listed in Near Me
    if (t === 'Other' || t === 'Specialty Store') return;
    const pt = turf.point(f.geometry.coordinates);
    const d = turf.distance(origin, pt, { units: distanceUnits === 'kilometers' ? 'kilometers' : 'miles' });
    const cur = byType.get(t);
    if (!cur || d < cur.dist) byType.set(t, { feature: f, dist: d });
  });

  // Sort by distance asc
  const rows = Array.from(byType.entries())
    .map(([type, obj]) => ({ type, name: obj.feature.properties.Store_Name || 'Unnamed', dist: obj.dist, coords: obj.feature.geometry.coordinates }))
    .sort((a,b) => a.dist - b.dist);

  if (rows.length === 0) {
    listEl.innerHTML = '<div class="near-item">No retailers found.</div>';
    return;
  }

  const originStr = `${nearLocation.lat},${nearLocation.lon}`;
  const html = rows.map(r => {
    const color = storeTypeColors[r.type] || storeTypeColors['Other'];
    const emoji = storeTypeIcons[r.type] || storeTypeIcons['Other'];
    const [destLon, destLat] = r.coords || [];
    const destStr = (destLat != null && destLon != null) ? `${destLat},${destLon}` : '';
    const dirHref = destStr ? `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(originStr)}&destination=${encodeURIComponent(destStr)}&travelmode=walking` : '#';
    const unitsLabel = distanceUnits === 'kilometers' ? ' km' : ' mi';
    return `
      <div class="near-item">
        <span class="marker-emoji" style="background-color:${color}">${emoji}</span>
        <span class="near-name">${r.name} <span style="color:#777">(${r.type})</span></span>
        <span class="near-dist">${r.dist.toFixed(2)}${unitsLabel}</span>
        <a class="near-dir" href="${dirHref}" target="_blank" rel="noopener">Directions</a>
      </div>
    `;
  }).join('');
  listEl.innerHTML = html;
  if (hintEl) hintEl.style.display = 'none';
}

// Filter logic
function filterData() {
  const selectedTypes = getSelectedStoreTypes();

  const base = (geojsonData && geojsonData.features) ? geojsonData.features : [];
  const extra = (showBorderRetailers && borderRetailersData && Array.isArray(borderRetailersData.features)) ? borderRetailersData.features : [];
  const combined = base.concat(extra);

  const filtered = {
    type: "FeatureCollection",
    features: combined.filter(f => {
      const storeMatch = selectedTypes.size === 0 || selectedTypes.has(f.properties.Store_Type);
      let wardMatch = false;
      let countyMatch = false;
      const hasWard = selectedWards.size > 0;
      const hasCounty = showBorderRetailers && selectedCounties.size > 0;
      // Compute geographic matches if needed
      if (hasWard || hasCounty) {
        if (window.turf) {
          try {
            const pt = turf.point(f.geometry.coordinates);
            if (hasWard) {
              for (const wid of selectedWards) {
                const geom = wardsById[wid];
                if (!geom) continue;
                const poly = (geom.type === 'Polygon') ? turf.polygon(geom.coordinates) : turf.multiPolygon(geom.coordinates);
                if (turf.booleanPointInPolygon(pt, poly)) { wardMatch = true; break; }
              }
            } else {
              wardMatch = true; // not constraining by wards
            }
            if (hasCounty) {
              for (const cid of selectedCounties) {
                const cgeom = countiesById[cid];
                if (!cgeom) continue;
                const cpoly = (cgeom.type === 'Polygon') ? turf.polygon(cgeom.coordinates) : turf.multiPolygon(cgeom.coordinates);
                if (turf.booleanPointInPolygon(pt, cpoly)) { countyMatch = true; break; }
              }
            } else {
              countyMatch = true; // not constraining by counties
            }
          } catch (e) {
            // On error, default to not excluding by geography
            wardMatch = hasWard ? false : true;
            countyMatch = hasCounty ? false : true;
          }
        } else {
          // Turf not available; avoid excluding
          wardMatch = hasWard ? true : true;
          countyMatch = hasCounty ? true : true;
        }
      } else {
        // No geographic constraints
        wardMatch = true;
        countyMatch = true;
      }

      // If both ward and county selections exist, use OR semantics (either passes)
      let geoMatch;
      if (hasWard && hasCounty) geoMatch = wardMatch || countyMatch;
      else if (hasWard) geoMatch = wardMatch;
      else if (hasCounty) geoMatch = countyMatch;
      else geoMatch = true;

      return storeMatch && geoMatch;
    })
  };

  // Update clustered source instead of DOM markers
  updateRetailerSource(filtered);

  // Update ward outline on map
  updateWardOutlineFromSelection();

  // Save current filtered and update legend + near me
  currentFilteredData = filtered;
  
  // Update legend
  updateLegend(filtered);
  // Update Near Me panel (if a location is set)
  updateNearMePanel(filtered);
}

// Populate dropdowns dynamically
function populateFilters(data) {
  const stores = new Set();
  data.features.forEach(f => { if (f.properties.Store_Type) stores.add(f.properties.Store_Type); });
  const container = document.getElementById('storeTypeFilters');
  if (!container) return;
  container.innerHTML = '';
  [...stores].sort().forEach(st => {
    const id = `st_${st.replace(/[^a-z0-9]+/gi,'_')}`;
    const label = document.createElement('label');
    const cb = document.createElement('input');
    cb.type = 'checkbox'; cb.value = st; cb.id = id;
    cb.addEventListener('change', filterData);
    const span = document.createElement('span'); span.textContent = st;
    label.appendChild(cb); label.appendChild(span);
    container.appendChild(label);
  });
}

// Populate ward dropdown and index ward geometries
function populateWardFilter(wards) {
  const panel = document.getElementById('wardDropdownPanel');
  const btn = document.getElementById('wardDropdownBtn');
  const dropdown = document.getElementById('wardDropdown');
  if (!panel || !wards || !wards.features) return;

  const items = wards.features
    .map(f => ({ id: String(f.properties.WARD_ID ?? f.properties.WARD ?? ''), label: f.properties.NAME || f.properties.LABEL || `Ward ${f.properties.WARD_ID}` , geom: f.geometry }))
    .filter(w => w.id);

  // Build geometry index
  wardsById = {};
  items.forEach(w => { wardsById[w.id] = w.geom; });

  // Sort by numeric ward id when possible
  items.sort((a,b) => Number(a.id) - Number(b.id));

  // Build checkboxes
  panel.innerHTML = '';
  items.forEach(w => {
    const label = document.createElement('label');
    const cb = document.createElement('input');
    cb.type = 'checkbox'; cb.value = w.id;
    cb.addEventListener('change', () => {
      if (cb.checked) selectedWards.add(w.id); else selectedWards.delete(w.id);
      syncWardDropdownLabel();
      updateWardOutlineFromSelection();
      filterData();
    });
    const span = document.createElement('span'); span.textContent = w.label;
    label.appendChild(cb); label.appendChild(span);
    panel.appendChild(label);
  });
  // Actions row (Select all / Clear)
  const actions = document.createElement('div'); actions.className = 'actions';
  const allBtn = document.createElement('button'); allBtn.type = 'button'; allBtn.textContent = 'Select all';
  const clrBtn = document.createElement('button'); clrBtn.type = 'button'; clrBtn.textContent = 'Clear';
  allBtn.addEventListener('click', () => {
    selectedWards = new Set(items.map(i => i.id));
    panel.querySelectorAll('input[type="checkbox"]').forEach(cb => cb.checked = true);
    syncWardDropdownLabel(); updateWardOutlineFromSelection(); filterData();
  });
  clrBtn.addEventListener('click', () => {
    selectedWards.clear();
    panel.querySelectorAll('input[type="checkbox"]').forEach(cb => cb.checked = false);
    syncWardDropdownLabel(); updateWardOutlineFromSelection(); filterData();
  });
  actions.appendChild(allBtn); actions.appendChild(clrBtn); panel.appendChild(actions);

  function syncWardDropdownLabel() {
    if (!btn) return;
    if (selectedWards.size === 0) { btn.textContent = 'All Wards ▾'; return; }
    const list = Array.from(selectedWards).sort((a,b)=>Number(a)-Number(b)).join(', ');
    btn.textContent = `Ward ${list} ▾`;
  }
  // Expose to outer scope
  window.syncWardDropdownLabel = syncWardDropdownLabel;

  // Toggle dropdown
  if (btn && dropdown) {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      dropdown.classList.toggle('open');
      const expanded = dropdown.classList.contains('open');
      btn.setAttribute('aria-expanded', expanded ? 'true' : 'false');
    });
    document.addEventListener('click', (e) => {
      if (!dropdown.contains(e.target)) {
        dropdown.classList.remove('open');
        btn.setAttribute('aria-expanded', 'false');
      }
    });
  }
}

// Populate county dropdown and index county geometries (hidden until bordering toggle is ON)
function populateCountyFilter(counties) {
  const panel = document.getElementById('countyDropdownPanel');
  const btn = document.getElementById('countyDropdownBtn');
  const dropdown = document.getElementById('countyDropdown');
  if (!panel || !counties || !counties.features) return;

  const items = counties.features
    .map(f => ({ id: String(f.properties.GEOID || f.properties.COUNTYFP || f.properties.NAME || ''), label: f.properties.NAME || f.properties.LABEL || String(f.properties.GEOID || f.properties.COUNTYFP), geom: f.geometry }))
    .filter(c => c.id);

  // Build geometry index
  countiesById = {};
  items.forEach(c => { countiesById[c.id] = c.geom; });

  // Sort alphabetically by county name
  items.sort((a,b) => String(a.label).localeCompare(String(b.label)));

  // Build checkboxes
  panel.innerHTML = '';
  items.forEach(c => {
    const label = document.createElement('label');
    const cb = document.createElement('input');
    cb.type = 'checkbox'; cb.value = c.id;
    cb.addEventListener('change', () => {
      if (cb.checked) selectedCounties.add(c.id); else selectedCounties.delete(c.id);
      syncCountyDropdownLabel();
      filterData();
    });
    const span = document.createElement('span'); span.textContent = c.label;
    label.appendChild(cb); label.appendChild(span);
    panel.appendChild(label);
  });
  // Actions row (Select all / Clear)
  const actions = document.createElement('div'); actions.className = 'actions';
  const allBtn = document.createElement('button'); allBtn.type = 'button'; allBtn.textContent = 'Select all';
  const clrBtn = document.createElement('button'); clrBtn.type = 'button'; clrBtn.textContent = 'Clear';
  allBtn.addEventListener('click', () => {
    selectedCounties = new Set(items.map(i => i.id));
    panel.querySelectorAll('input[type="checkbox"]').forEach(cb => cb.checked = true);
    syncCountyDropdownLabel(); filterData();
  });
  clrBtn.addEventListener('click', () => {
    selectedCounties.clear();
    panel.querySelectorAll('input[type="checkbox"]').forEach(cb => cb.checked = false);
    syncCountyDropdownLabel(); filterData();
  });
  actions.appendChild(allBtn); actions.appendChild(clrBtn); panel.appendChild(actions);

  function syncCountyDropdownLabel() {
    if (!btn) return;
    if (selectedCounties.size === 0) { btn.textContent = 'All Counties ▾'; return; }
    const list = Array.from(selectedCounties).map(id => {
      // Try to recover label by id
      const item = items.find(i => i.id === id);
      return item ? item.label : id;
    }).sort((a,b)=>String(a).localeCompare(String(b))).join(', ');
    btn.textContent = `${list} ▾`;
  }
  // Expose to outer scope for reset usage
  window.syncCountyDropdownLabel = syncCountyDropdownLabel;

  // Toggle dropdown
  if (btn && dropdown) {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      dropdown.classList.toggle('open');
      const expanded = dropdown.classList.contains('open');
      btn.setAttribute('aria-expanded', expanded ? 'true' : 'false');
    });
    document.addEventListener('click', (e) => {
      if (!dropdown.contains(e.target)) {
        dropdown.classList.remove('open');
        btn.setAttribute('aria-expanded', 'false');
      }
    });
  }
}

// Build/update the legend with counts per store type
function updateLegend(collection) {
  const el = document.getElementById('legend');
  if (!el) return;
  const counts = new Map();
  if (collection && collection.features) {
    collection.features.forEach(f => {
      const t = f.properties && f.properties.Store_Type ? f.properties.Store_Type : 'Other';
      counts.set(t, (counts.get(t) || 0) + 1);
    });
  }
  // Sort alphabetically by type
  const items = Array.from(counts.entries()).sort((a,b) => String(a[0]).localeCompare(String(b[0])));
  if (items.length === 0) {
    el.innerHTML = '';
    return;
  }
  const total = (collection && collection.features) ? collection.features.length : 0;
  const htmlItems = items.map(([type, count]) => {
    const color = storeTypeColors[type] || storeTypeColors['Other'];
    const emoji = storeTypeIcons[type] || storeTypeIcons['Other'];
    return `
      <div class="legend-item">
        <span class="marker-emoji legend-marker" style="background-color:${color}">${emoji}</span>
        <span class="legend-label">${type}</span>
        <span class="legend-count">${count}</span>
      </div>
    `;
  }).join('');
  el.innerHTML = `<div class="legend-title">Store Types</div>${htmlItems}<div class="legend-total">Total Stores: ${total}</div>`;
}

// Update user location source data
function updateUserLocation(lon, lat) {
  try {
    const src = map.getSource('user-location');
    if (!src) return;
    currentGeo = { lon, lat };
    const fc = {
      type: 'FeatureCollection',
      features: [
        { type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [lon, lat] } }
      ]
    };
    src.setData(fc);
  } catch (e) {
    console.warn('Failed updating user location:', e);
  }
}

// Helper to set Near Me location and update panel
function setNearLocation(lon, lat, recenter = false, source = 'manual') {
  nearLocation = { lon, lat };
  if (recenter) {
    map.flyTo({ center: [lon, lat], zoom: Math.max(map.getZoom(), 13) });
  }
  // If the source is user's current geolocation, do not add an extra pin
  const isGeo = source === 'geo';
  updateNearLocationMarker(lon, lat, isGeo);
  updateNearMePanel(currentFilteredData || geojsonData);
}

function updateNearLocationMarker(lon, lat, hide) {
  try {
    if (nearMarker) { nearMarker.remove(); nearMarker = null; }
    if (hide) return;
    const el = document.createElement('div');
    el.className = 'near-pin';
    el.textContent = '📍';
    nearMarker = new mapboxgl.Marker({ element: el, anchor: 'bottom' })
      .setLngLat([lon, lat])
      .addTo(map);
  } catch (e) { /* noop */ }
}

// Toggle pick-on-map mode (updates hint + button state)
function togglePickMode(on) {
  pickLocationMode = !!on;
  const hint = document.getElementById('nearHint');
  const btn = document.getElementById('nearPick');
  if (hint) hint.style.display = pickLocationMode ? 'block' : 'none';
  if (btn) btn.textContent = pickLocationMode ? 'Cancel pick' : 'Pick on map';
}

// Draw or clear the selected ward outline
function updateWardOutlineFromSelection() {
  const polySrc = map.getSource('selected-ward');
  const lineSrc = map.getSource('selected-ward-line');
  if (!polySrc || !lineSrc) return;
  if (!window.turf) return;
  if (!selectedWards || selectedWards.size === 0) {
    polySrc.setData({ type: 'FeatureCollection', features: [] });
    lineSrc.setData({ type: 'FeatureCollection', features: [] });
    return;
  }
  try {
    const features = [];
    const lineFeatures = [];
    selectedWards.forEach((wid) => {
      const geom = wardsById[wid];
      if (!geom) return;
      features.push({ type: 'Feature', properties: { WARD_ID: wid }, geometry: geom });
      const poly = (geom.type === 'Polygon') ? turf.polygon(geom.coordinates) : turf.multiPolygon(geom.coordinates);
      const lf = turf.polygonToLine(poly);
      if (lf.type === 'FeatureCollection') lineFeatures.push(...lf.features); else lineFeatures.push(lf);
    });
    polySrc.setData({ type: 'FeatureCollection', features });
    lineSrc.setData({ type: 'FeatureCollection', features: lineFeatures });
  } catch (e) {
    console.error('Ward outline update failed:', e);
  }
}

// Clip retailers to DC boundary, set max bounds, and update mask
function updateDCMaskAndBounds() {
  const maskSrc = map.getSource('dc-mask');
  const lineSrc = map.getSource('dc-boundary-line');
  if (dcPolygon && window.turf) {
    try {
      // Determine the area to exclude from the mask: DC alone, or DC + counties when toggled
      let area = dcPolygon;
      if (showBorderRetailers && countiesData && Array.isArray(countiesData.features)) {
        try {
          let unionGeom = area;
          for (const f of countiesData.features) {
            if (!f || !f.geometry) continue;
            const poly = (f.geometry.type === 'Polygon') ? turf.polygon(f.geometry.coordinates) : turf.multiPolygon(f.geometry.coordinates);
            // union may fail in some topologies, so guard
            try { unionGeom = turf.union(unionGeom, poly) || unionGeom; } catch (_) {}
          }
          area = unionGeom || area;
        } catch (_) { /* keep DC only */ }
      }

      // Fit view bounds first time only (based on DC alone)
      const b = turf.bbox(dcPolygon);
      const bounds = [[b[0], b[1]], [b[2], b[3]]];
      if (!dcBoundsApplied) {
        map.fitBounds(bounds, { padding: 30, duration: 0 });
        dcBoundsApplied = true;
        try { dcBounds = bounds; } catch (_) {}
      }

      // Build an outside mask (world minus area)
      const maskPoly = turf.mask(area);
      if (maskSrc) {
        maskSrc.setData(maskPoly);
      }

      // Update DC boundary outline line and raise it above other layers
      if (lineSrc) {
        const lineFeat = turf.polygonToLine(dcPolygon);
        const lineFC = lineFeat.type === 'FeatureCollection' ? lineFeat : { type: 'FeatureCollection', features: [lineFeat] };
        lineSrc.setData(lineFC);
      }
      if (map.getLayer('dc-boundary-outline')) {
        try { map.moveLayer('dc-boundary-outline'); } catch (_) {}
      }

      // Toggle counties outline visibility based on bordering toggle
      if (map.getLayer('counties-outline')) {
        try { map.setLayoutProperty('counties-outline', 'visibility', showBorderRetailers ? 'visible' : 'none'); } catch (_) {}
        try { map.moveLayer('counties-outline'); } catch (_) {}
      }
    } catch (e) {
      console.error('Failed to update DC mask/bounds:', e);
    }
  }
}

function filterRetailersToDC(collection) {
  if (!dcPolygon || !window.turf || !collection || !collection.features) return collection;
  const filtered = collection.features.filter(f => {
    try {
      const pt = turf.point(f.geometry.coordinates);
      return turf.booleanPointInPolygon(pt, dcPolygon);
    } catch (e) {
      return false;
    }
  });
  return { type: 'FeatureCollection', features: filtered };
}

// Load retailers supporting line-delimited GeoJSON (geojsonl/ndjson), fallback to standard GeoJSON
async function loadRetailersFlexible(basePath) {
  // Try .geojsonl
  try {
    const res = await fetch(`${basePath}.geojsonl`);
    if (res.ok) {
      const text = await res.text();
      const features = parseNdjsonFeatures(text);
      if (features && features.length) {
        return { type: 'FeatureCollection', features };
      }
    }
  } catch (_) {}
  // Try .ndjson
  try {
    const res = await fetch(`${basePath}.ndjson`);
    if (res.ok) {
      const text = await res.text();
      const features = parseNdjsonFeatures(text);
      if (features && features.length) {
        return { type: 'FeatureCollection', features };
      }
    }
  } catch (_) {}
  // Fallback .geojson
  const res = await fetch(`${basePath}.geojson`);
  return await res.json();
}

function parseNdjsonFeatures(text) {
  if (!text) return [];
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const features = [];
  for (const line of lines) {
    try {
      const obj = JSON.parse(line);
      if (obj && obj.type === 'Feature' && obj.geometry) {
        features.push(obj);
      } else if (obj && obj.type === 'FeatureCollection' && Array.isArray(obj.features)) {
        features.push(...obj.features);
      }
    } catch (_) {
      // ignore malformed lines
    }
  }
  return features;
}

// Load data (retailers and wards)
Promise.all([
  loadRetailersFlexible('data/SNAP_Retailer_Location_data'),
  fetch('data/Wards_from_2022.geojson').then(r => r.json()),
  fetch('data/Washington_DC_Boundary_Stone_Area.geojson').then(r => r.json()),
  fetch('data/bordering_counties.geojson').then(r => r.json()).catch(() => ({ type: 'FeatureCollection', features: [] })),
  fetch('data/dc_area_counties.geojson').then(r => r.json()).catch(() => ({ type: 'FeatureCollection', features: [] }))
])
.then(([retailers, wards, dc, border, counties]) => {
  geojsonData = retailers;
  wardsData = wards;
  borderRetailersData = border && border.type === 'FeatureCollection' ? border : { type: 'FeatureCollection', features: [] };
  countiesData = counties && counties.type === 'FeatureCollection' ? counties : { type: 'FeatureCollection', features: [] };
  // Extract DC boundary geometry and prepare Turf polygon
  try {
    const dcFeat = (dc && dc.features) ? dc.features.find(f => f.geometry && (f.geometry.type === 'Polygon' || f.geometry.type === 'MultiPolygon')) : null;
    if (dcFeat) {
      dcBoundaryGeom = dcFeat.geometry;
      dcPolygon = (dcBoundaryGeom.type === 'Polygon')
        ? turf.polygon(dcBoundaryGeom.coordinates)
        : turf.multiPolygon(dcBoundaryGeom.coordinates);
    }
  } catch (e) {
    console.error('Failed to parse DC boundary geometry:', e);
  }

  // Filter retailers to DC only (if boundary available)
  geojsonData = filterRetailersToDC(geojsonData);
  populateFilters(geojsonData);
  populateWardFilter(wardsData);
  populateCountyFilter(countiesData);
  applyAggregationSetting();
  updateRetailerSource(geojsonData);
  updateLegend(geojsonData);
  currentFilteredData = geojsonData;

  // Ward selection now handled by dropdown checkboxes and map clicks

  // Update mask and bounds now that boundary is known
  updateDCMaskAndBounds();

  // Add wards layer for click-to-filter and light tint
  try {
    if (!map.getSource('wards')) {
      map.addSource('wards', { type: 'geojson', data: wardsData });
    }
    if (!map.getLayer('wards-fill')) {
      map.addLayer({
        id: 'wards-fill', type: 'fill', source: 'wards',
        paint: { 'fill-color': '#033C5A', 'fill-opacity': 0.05 }
      }, 'selected-ward-fill');
    }
    if (!map.getLayer('wards-outline')) {
      map.addLayer({ id: 'wards-outline', type: 'line', source: 'wards', paint: { 'line-color': '#033C5A', 'line-width': 1, 'line-opacity': 0.4 } }, 'selected-ward-outline');
    }
    map.on('click', 'wards-fill', (e) => {
      const f = e.features && e.features[0];
      if (!f) return;
      const w = String(f.properties.WARD_ID ?? f.properties.WARD ?? '');
      if (!w) return;
      if (selectedWards.has(w)) selectedWards.delete(w); else selectedWards.add(w);
      // Sync UI checkboxes
      const panel = document.getElementById('wardDropdownPanel');
      if (panel) {
        const cb = panel.querySelector(`input[type="checkbox"][value="${w}"]`);
        if (cb) cb.checked = selectedWards.has(w);
      }
      if (window.syncWardDropdownLabel) window.syncWardDropdownLabel();
      updateWardOutlineFromSelection();
      filterData();
    });
    map.on('mouseenter', 'wards-fill', () => { map.getCanvas().style.cursor = 'pointer'; });
    map.on('mouseleave', 'wards-fill', () => { map.getCanvas().style.cursor = ''; });
  } catch (e) { console.warn('Wards layer add failed:', e); }

  // Counties outline layer (initially hidden; shown when bordering retailers are toggled on)
  try {
    if (!map.getSource('counties')) {
      map.addSource('counties', { type: 'geojson', data: countiesData });
    } else {
      const s = map.getSource('counties');
      if (s && s.setData) s.setData(countiesData);
    }
    if (!map.getLayer('counties-outline')) {
      map.addLayer({
        id: 'counties-outline',
        type: 'line',
        source: 'counties',
        layout: { 'line-join': 'round', 'line-cap': 'round', 'visibility': showBorderRetailers ? 'visible' : 'none' },
        paint: {
          'line-color': '#000000',
          'line-width': 5,
          'line-opacity': 1,
          'line-blur': 0
        }
      });
      try { map.moveLayer('counties-outline'); } catch (_) {}
    }
  } catch (e) { console.warn('Counties layer add failed:', e); }

  // Near Me panel handlers
  const nearSearchBtn = document.getElementById('nearSearch');
  const nearAddrInput = document.getElementById('nearAddress');
  const nearUseGeoBtn = document.getElementById('nearUseGeo');
  const nearPickBtn = document.getElementById('nearPick');

  async function geocodeAndSet(query) {
    if (!query) return;
    try {
      const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(query)}.json?limit=1&access_token=${encodeURIComponent(MAPBOX_TOKEN)}`;
      const resp = await fetch(url);
      const gj = await resp.json();
      const f = gj && gj.features && gj.features[0];
      if (f && f.center) {
        setNearLocation(f.center[0], f.center[1], true, 'search');
      }
    } catch (e) {
      console.warn('Geocode failed:', e);
    }
  }

  if (nearSearchBtn && nearAddrInput) {
    nearSearchBtn.addEventListener('click', () => geocodeAndSet(nearAddrInput.value.trim()));
    nearAddrInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') geocodeAndSet(nearAddrInput.value.trim());
    });
  }
  if (nearUseGeoBtn) {
    nearUseGeoBtn.addEventListener('click', () => {
      if (currentGeo.lon != null && currentGeo.lat != null) {
        setNearLocation(currentGeo.lon, currentGeo.lat, true, 'geo');
      } else if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
          (pos) => setNearLocation(pos.coords.longitude, pos.coords.latitude, true, 'geo'),
          (err) => console.warn('Geolocation (on demand) error:', err),
          { enableHighAccuracy: true, maximumAge: 10000, timeout: 10000 }
        );
      }
    });
  }
  if (nearPickBtn) {
    nearPickBtn.addEventListener('click', () => togglePickMode(!pickLocationMode));
  }

  const nearUseCenterBtn = document.getElementById('nearUseCenter');
  if (nearUseCenterBtn) {
    nearUseCenterBtn.addEventListener('click', () => {
      const c = map.getCenter();
      setNearLocation(c.lng, c.lat, true, 'center');
    });
  }
  const unitsSel = document.getElementById('unitsSelect');
  if (unitsSel) {
    unitsSel.addEventListener('change', () => {
      distanceUnits = unitsSel.value === 'kilometers' ? 'kilometers' : 'miles';
      updateNearMePanel(currentFilteredData || geojsonData);
    });
  }

  // Clear and Home buttons
  const clearBtn = document.getElementById('clearFilters');
  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      const container = document.getElementById('storeTypeFilters');
      if (container) {
        container.querySelectorAll('input[type="checkbox"]').forEach(cb => { cb.checked = false; });
      }
      // Clear ward selection checkboxes
      selectedWards.clear();
      const wardPanel = document.getElementById('wardDropdownPanel');
      if (wardPanel) wardPanel.querySelectorAll('input[type="checkbox"]').forEach(cb => cb.checked = false);
      if (window.syncWardDropdownLabel) window.syncWardDropdownLabel();
      // Clear county selection (if visible)
      selectedCounties.clear();
      const countyPanel = document.getElementById('countyDropdownPanel');
      if (countyPanel) countyPanel.querySelectorAll('input[type="checkbox"]').forEach(cb => cb.checked = false);
      if (window.syncCountyDropdownLabel) window.syncCountyDropdownLabel();
      updateWardOutlineFromSelection();
      filterData();
    });
  }
  // Bordering counties toggle button
  const borderBtn = document.getElementById('toggleBorderRetailers');
  if (borderBtn) {
    const syncLabel = () => {
      borderBtn.textContent = showBorderRetailers ? 'Hide SNAP retailers in bordering counties' : 'Show SNAP retailers in bordering counties';
    };
    syncLabel();
    borderBtn.addEventListener('click', () => {
      showBorderRetailers = !showBorderRetailers;
      syncLabel();
      // Show/hide county filter group
      try {
        const countyGroup = document.getElementById('countyFilterGroup');
        if (countyGroup) {
          if (showBorderRetailers) {
            countyGroup.style.display = '';
          } else {
            countyGroup.style.display = 'none';
            // Clear selections when hiding
            selectedCounties.clear();
            const panel = document.getElementById('countyDropdownPanel');
            if (panel) panel.querySelectorAll('input[type="checkbox"]').forEach(cb => cb.checked = false);
            if (window.syncCountyDropdownLabel) window.syncCountyDropdownLabel();
          }
        }
      } catch (_) {}
      // Update mask and counties outline visibility
      updateDCMaskAndBounds();
      filterData();
    });
  }
  const homeBtn = document.getElementById('homeView');
  if (homeBtn) {
    homeBtn.addEventListener('click', () => {
      if (dcBounds) { map.fitBounds(dcBounds, { padding: 30 }); }
      else { map.flyTo({ center: [-77.0369, 38.9072], zoom: 11 }); }
    });
  }
})
.catch(err => console.error('Error loading data:', err));
