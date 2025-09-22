

mapboxgl.accessToken = "pk.eyJ1Ijoib21ja2Vhcm51dyIsImEiOiJjbWZ2cWNyYWcwNWRoMmtwdWc5amk1bWxiIn0.5uwt4drO_Ej32d0C_qqOwQ";




const map = new mapboxgl.Map({
  container: 'map',
  style: 'mapbox://styles/mapbox/streets-v12',
  center: [-77.0369, 38.9072], // DC center
  zoom: 11
});

// Add basic navigation (zoom/rotate) controls
map.addControl(new mapboxgl.NavigationControl({ visualizePitch: true }), 'top-right');

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

  // Map click to pick a location (when enabled)
  map.on('click', (e) => {
    if (!pickLocationMode) return;
    setNearLocation(e.lngLat.lng, e.lngLat.lat, true, 'pick');
    togglePickMode(false);
  });
});

let geojsonData;
let wardsData;
let wardsById = {};
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

// Utility to clear markers
function clearMarkers() {
  markers.forEach(m => m.remove());
  markers = [];
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

    const popup = new mapboxgl.Popup({ offset: 20 }).setHTML(`
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
    const d = turf.distance(origin, pt, { units: 'miles' });
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
    return `
      <div class="near-item">
        <span class="marker-emoji" style="background-color:${color}">${emoji}</span>
        <span class="near-name">${r.name} <span style="color:#777">(${r.type})</span></span>
        <span class="near-dist">${r.dist.toFixed(2)} mi</span>
        <a class="near-dir" href="${dirHref}" target="_blank" rel="noopener">Directions</a>
      </div>
    `;
  }).join('');
  listEl.innerHTML = html;
  if (hintEl) hintEl.style.display = 'none';
}

// Filter logic
function filterData() {
  const storeFilter = document.getElementById('storeFilter').value;
  const wardFilter = document.getElementById('wardFilter') ? document.getElementById('wardFilter').value : 'all';

  const filtered = {
    type: "FeatureCollection",
    features: geojsonData.features.filter(f => {
      const storeMatch = storeFilter === "all" || f.properties.Store_Type === storeFilter;
      let wardMatch = true;
      if (wardFilter !== 'all') {
        const geom = wardsById[wardFilter];
        if (geom && window.turf) {
          try {
            const pt = turf.point(f.geometry.coordinates);
            const poly = (geom.type === 'Polygon')
              ? turf.polygon(geom.coordinates)
              : turf.multiPolygon(geom.coordinates);
            wardMatch = turf.booleanPointInPolygon(pt, poly);
          } catch (e) {
            console.error('Ward filter error:', e);
            wardMatch = true; // fail open
          }
        }
      }
      return storeMatch && wardMatch;
    })
  };

  clearMarkers();
  addMarkers(filtered);

  // Update ward outline on map
  updateWardOutline(wardFilter);

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

  data.features.forEach(f => {
    if (f.properties.Store_Type) stores.add(f.properties.Store_Type);
  });

  const storeSelect = document.getElementById('storeFilter');
  [...stores].sort().forEach(st => {
    const opt = document.createElement('option');
    opt.value = st;
    opt.textContent = st;
    storeSelect.appendChild(opt);
  });
}

// Populate ward dropdown and index ward geometries
function populateWardFilter(wards) {
  const wardSelect = document.getElementById('wardFilter');
  if (!wardSelect || !wards || !wards.features) return;

  const items = wards.features
    .map(f => ({ id: String(f.properties.WARD_ID ?? f.properties.WARD ?? ''), label: f.properties.NAME || f.properties.LABEL || `Ward ${f.properties.WARD_ID}` , geom: f.geometry }))
    .filter(w => w.id);

  // Build geometry index
  wardsById = {};
  items.forEach(w => { wardsById[w.id] = w.geom; });

  // Sort by numeric ward id when possible
  items.sort((a,b) => Number(a.id) - Number(b.id));

  items.forEach(w => {
    const opt = document.createElement('option');
    opt.value = w.id;
    opt.textContent = w.label;
    wardSelect.appendChild(opt);
  });
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
  // Sort by count desc
  const items = Array.from(counts.entries()).sort((a,b) => b[1] - a[1]);
  if (items.length === 0) {
    el.innerHTML = '';
    return;
  }
  const html = items.map(([type, count]) => {
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
  el.innerHTML = html;
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
function updateWardOutline(wardId) {
  const polySrc = map.getSource('selected-ward');
  const lineSrc = map.getSource('selected-ward-line');
  if (!polySrc || !lineSrc) return; // style not ready yet

  if (wardId && wardId !== 'all' && wardsById[wardId]) {
    const geom = wardsById[wardId];
    const polyFeature = { type: 'Feature', properties: { WARD_ID: wardId }, geometry: geom };
    polySrc.setData({ type: 'FeatureCollection', features: [polyFeature] });

    // Convert polygon to line for outline layer
    if (window.turf) {
      try {
        const poly = (geom.type === 'Polygon')
          ? turf.polygon(geom.coordinates)
          : turf.multiPolygon(geom.coordinates);
        const lineFeat = turf.polygonToLine(poly);
        lineSrc.setData({ type: 'FeatureCollection', features: [lineFeat] });
      } catch (e) {
        console.error('Failed to create ward outline line:', e);
        lineSrc.setData({ type: 'FeatureCollection', features: [] });
      }
    }
  } else {
    polySrc.setData({ type: 'FeatureCollection', features: [] });
    lineSrc.setData({ type: 'FeatureCollection', features: [] });
  }
}

// Clip retailers to DC boundary, set max bounds, and update mask
function updateDCMaskAndBounds() {
  const maskSrc = map.getSource('dc-mask');
  const lineSrc = map.getSource('dc-boundary-line');
  if (dcPolygon && window.turf) {
    try {
      // Fit view to DC bbox (without constraining zoom/pan)
      const b = turf.bbox(dcPolygon);
      const bounds = [[b[0], b[1]], [b[2], b[3]]];
      if (!dcBoundsApplied) {
        map.fitBounds(bounds, { padding: 30, duration: 0 });
        dcBoundsApplied = true;
      }

      // Build an outside mask (world minus DC)
      const maskPoly = turf.mask(dcPolygon);
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

// Load data (retailers and wards)
Promise.all([
  fetch('data/SNAP_Retailer_Location_data.geojson').then(r => r.json()),
  fetch('data/Wards_from_2022.geojson').then(r => r.json()),
  fetch('data/Washington_DC_Boundary_Stone_Area.geojson').then(r => r.json())
])
.then(([retailers, wards, dc]) => {
  geojsonData = retailers;
  wardsData = wards;
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
  addMarkers(geojsonData);
  updateLegend(geojsonData);
  currentFilteredData = geojsonData;

  document.getElementById('storeFilter').addEventListener('change', filterData);
  const wardEl = document.getElementById('wardFilter');
  if (wardEl) wardEl.addEventListener('change', filterData);

  // Update mask and bounds now that boundary is known
  updateDCMaskAndBounds();

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
})
.catch(err => console.error('Error loading data:', err));
