/* ==========================================================================
   Urban Service Inequality — Colombo District
   Web GIS Application Logic (Leaflet.js)
   ==========================================================================
   Data expected in /data:
     - Accessibility Index.geojson  (polygons: GN_NAME, POPULATION,
                                      accessibility_index, priority_index)
     - Hospitals.geojson  (points)
     - Schools.geojson    (points)
     - Banks.geojson      (points)
     - Parks.geojson      (points)
     - Bus Stops.geojson  (points)

   If your file names differ, only the DATA_FILES object below needs to
   change — nothing else in the app depends on the file names.
   ========================================================================== */

/* -------------------------------------------------------------------------
   0. CONFIG
   ------------------------------------------------------------------------- */
const DATA_FILES = {
  gn:        'data/GND_layer.geojson',
  Hospitals: 'data/Hospitals.geojson',
  Schools:   'data/Schools.geojson',
  Banks:     'data/Banks.geojson',
  Parks:     'data/Parks.geojson',
  BusStops:  'data/Bus Stops.geojson'
};

// Field names on the gn polygon layer (edit here if your schema differs)
const FIELD = {
  name:        'ADM4_EN',
  population:  'Colombo_1',
  accessibility: 'AI',
  priority:    'priority_index'
};

// Colors per service layer + a text glyph used inside the marker
const SERVICE_STYLE = {
  Hospitals: { color: '#d7304a', glyph: '+',  label: 'Hospital' },
  Schools:   { color: '#2f6fed', glyph: 'S',  label: 'School' },
  Banks:     { color: '#c99a2e', glyph: '$',  label: 'Bank' },
  Parks:     { color: '#2f9e6b', glyph: '\u2698', label: 'Park' },
  BusStops:  { color: '#8452d5', glyph: '\u2261', label: 'Bus Stop' }
};

// Accessibility Index — 5 class scheme (low -> high = worse -> better)
const ACCESSIBILITY_CLASSES = [
  { label: 'Very Poor', color: '#d7304a' },
  { label: 'Poor',       color: '#f2884f' },
  { label: 'Moderate',   color: '#f5cc5b' },
  { label: 'Good',       color: '#8dc06a' },
  { label: 'Excellent',  color: '#1c8a5c' }
];

// Priority Index — 3 class scheme (low -> high = low -> high priority)
const PRIORITY_CLASSES = [
  { label: 'Low Priority',    color: '#2f9e6b' },
  { label: 'Medium Priority', color: '#ef9d3d' },
  { label: 'High Priority',   color: '#e0433f' }
];

/* -------------------------------------------------------------------------
   1. MAP + BASEMAP
   ------------------------------------------------------------------------- */
const map = L.map('map', {
  zoomControl: false,
  minZoom: 9
}).setView([6.9271, 79.9612], 11); // fallback view; refit once data loads

L.control.zoom({ position: 'bottomright' }).addTo(map);

const osmBasemap = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  maxZoom: 19
}).addTo(map);

/* -------------------------------------------------------------------------
   2. STATE
   ------------------------------------------------------------------------- */
let gnLayer = null;              // L.geoJSON layer for GN Divisions (choropleth)
let currentTheme = 'accessibility'; // 'accessibility' | 'priority'
let accBreaks = null;            // computed quantile breaks for accessibility_index
let priBreaks = null;            // computed quantile breaks for priority_index
let allGnFeatures = [];          // cached features for search
let selectedLayer = null;        // currently selected GN polygon (for persistent highlight)

const serviceLayers = {};        // { Hospitals: L.layerGroup, ... }
const serviceCounts = {};        // { Hospitals: 12, ... }

/* -------------------------------------------------------------------------
   3. UTILITIES
   ------------------------------------------------------------------------- */

// Quantile-based class breaks: returns array of upper-bound thresholds
function computeQuantileBreaks(values, numClasses) {
  const sorted = values.filter(v => typeof v === 'number' && !isNaN(v)).sort((a, b) => a - b);
  if (sorted.length === 0) return [];
  const breaks = [];
  for (let i = 1; i < numClasses; i++) {
    const idx = Math.floor((i / numClasses) * (sorted.length - 1));
    breaks.push(sorted[idx]);
  }
  breaks.push(sorted[sorted.length - 1]); // final upper bound = max
  return breaks;
}

// Given a value and a breaks array, return the class index (0-based)
function classify(value, breaks) {
  if (value === undefined || value === null || isNaN(value)) return -1;
  for (let i = 0; i < breaks.length; i++) {
    if (value <= breaks[i]) return i;
  }
  return breaks.length - 1;
}

function getAccessibilityStyle(value) {
  if (!accBreaks) return { color: '#ccc', label: 'No data' };
  const idx = classify(value, accBreaks);
  return idx === -1 ? { color: '#ccc', label: 'No data' } : ACCESSIBILITY_CLASSES[idx];
}

function getPriorityStyle(value) {
  if (!priBreaks) return { color: '#ccc', label: 'No data' };
  const idx = classify(value, priBreaks);
  return idx === -1 ? { color: '#ccc', label: 'No data' } : PRIORITY_CLASSES[idx];
}

function fmtNumber(n, decimals = 2) {
  if (n === undefined || n === null || isNaN(n)) return 'N/A';
  return Number(n).toLocaleString(undefined, { maximumFractionDigits: decimals });
}

function setMapStatus(text, autoHide = false) {
  const el = document.getElementById('mapStatus');
  el.textContent = text;
  el.classList.remove('hidden');
  if (autoHide) {
    setTimeout(() => el.classList.add('hidden'), 1800);
  }
}

/* -------------------------------------------------------------------------
   4. GN DIVISION (CHOROPLETH) LAYER
   ------------------------------------------------------------------------- */

function styleForCurrentTheme(feature) {
  const props = feature.properties || {};
  const value = currentTheme === 'accessibility'
    ? props[FIELD.accessibility]
    : props[FIELD.priority];

  const info = currentTheme === 'accessibility'
    ? getAccessibilityStyle(value)
    : getPriorityStyle(value);

  return {
    fillColor: info.color,
    color: '#ffffff',
    weight: 1,
    fillOpacity: 0.78,
    opacity: 1
  };
}

function buildGnPopupHtml(props) {
  const accInfo = getAccessibilityStyle(props[FIELD.accessibility]);
  const priInfo = getPriorityStyle(props[FIELD.priority]);
  return `
    <div class="popup-title">${props[FIELD.name] ?? 'Unnamed GN Division'}</div>
    <div class="popup-row"><span class="k">Population</span><span class="v">${fmtNumber(props[FIELD.population], 0)}</span></div>
    <div class="popup-row"><span class="k">Accessibility Index</span><span class="v">${fmtNumber(props[FIELD.accessibility])}</span></div>
    <div class="popup-row"><span class="k">Priority Index</span><span class="v">${fmtNumber(props[FIELD.priority])}</span></div>
    <span class="info-badge" style="background:${accInfo.color}">${accInfo.label}</span>
    <span class="info-badge" style="background:${priInfo.color}">${priInfo.label}</span>
  `;
}

function updateInfoPanel(props) {
  const accInfo = getAccessibilityStyle(props[FIELD.accessibility]);
  const priInfo = getPriorityStyle(props[FIELD.priority]);
  document.getElementById('infoBody').innerHTML = `
    <div class="info-row"><span class="k">GN Name</span><span class="v">${props[FIELD.name] ?? 'N/A'}</span></div>
    <div class="info-row"><span class="k">Population</span><span class="v">${fmtNumber(props[FIELD.population], 0)}</span></div>
    <div class="info-row"><span class="k">Accessibility Index</span><span class="v">${fmtNumber(props[FIELD.accessibility])}</span></div>
    <div class="info-row"><span class="k">Priority Index</span><span class="v">${fmtNumber(props[FIELD.priority])}</span></div>
    <span class="info-badge" style="background:${accInfo.color}">${accInfo.label}</span>
    <span class="info-badge" style="background:${priInfo.color}">${priInfo.label}</span>
  `;
}

function onEachGnFeature(feature, layer) {
  layer.bindPopup(buildGnPopupHtml(feature.properties || {}));

  layer.on({
    mouseover: (e) => {
      const l = e.target;
      l.setStyle({ weight: 3, color: '#10233f', fillOpacity: 0.9 });
      l.bringToFront();
      updateInfoPanel(feature.properties || {});
    },
    mouseout: (e) => {
      if (selectedLayer !== e.target) {
        gnLayer.resetStyle(e.target);
      }
    },
    click: (e) => {
      if (selectedLayer) gnLayer.resetStyle(selectedLayer);
      selectedLayer = e.target;
      selectedLayer.setStyle({ weight: 3, color: '#10233f', fillOpacity: 0.9 });
      map.fitBounds(e.target.getBounds(), { maxZoom: 15 });
      updateInfoPanel(feature.properties || {});
    }
  });
}

function loadGnLayer(geojson) {
  allGnFeatures = geojson.features || [];

  // Compute classification breaks once, from the full dataset
  const accValues = allGnFeatures.map(f => f.properties?.[FIELD.accessibility]);
  const priValues = allGnFeatures.map(f => f.properties?.[FIELD.priority]);
  accBreaks = computeQuantileBreaks(accValues, ACCESSIBILITY_CLASSES.length);
  priBreaks = computeQuantileBreaks(priValues, PRIORITY_CLASSES.length);

  gnLayer = L.geoJSON(geojson, {
    style: styleForCurrentTheme,
    onEachFeature: onEachGnFeature
  }).addTo(map);

  // Average accessibility index for the dashboard
  const validAcc = accValues.filter(v => typeof v === 'number' && !isNaN(v));
  const avgAcc = validAcc.length ? validAcc.reduce((a, b) => a + b, 0) / validAcc.length : NaN;
  document.getElementById('statAvgAccessibility').textContent = fmtNumber(avgAcc);

  renderLegend();
  map.fitBounds(gnLayer.getBounds(), { padding: [20, 20] });
}

/* -------------------------------------------------------------------------
   5. LEGEND
   ------------------------------------------------------------------------- */
function renderLegend() {
  const title = document.getElementById('legendTitle');
  const body = document.getElementById('legendBody');
  body.innerHTML = '';

  const classes = currentTheme === 'accessibility' ? ACCESSIBILITY_CLASSES : PRIORITY_CLASSES;
  title.textContent = currentTheme === 'accessibility'
    ? 'Legend — Accessibility Index'
    : 'Legend — Priority Areas';

  classes.forEach(c => {
    const row = document.createElement('div');
    row.className = 'legend-row';
    row.innerHTML = `<span class="legend-swatch" style="background:${c.color}"></span><span>${c.label}</span>`;
    body.appendChild(row);
  });

  const note = document.createElement('div');
  note.className = 'legend-note';
  note.textContent = currentTheme === 'accessibility'
    ? 'Classes derived from quantiles of accessibility_index across all GN Divisions.'
    : 'Classes derived from quantiles of priority_index across all GN Divisions.';
  body.appendChild(note);
}

/* -------------------------------------------------------------------------
   6. THEME SWITCH (Accessibility <-> Priority)
   ------------------------------------------------------------------------- */
document.querySelectorAll('.theme-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.theme-btn').forEach(b => {
      b.classList.remove('active');
      b.setAttribute('aria-checked', 'false');
    });
    btn.classList.add('active');
    btn.setAttribute('aria-checked', 'true');

    currentTheme = btn.dataset.theme;
    if (gnLayer) gnLayer.setStyle(styleForCurrentTheme);
    renderLegend();
  });
});

/* -------------------------------------------------------------------------
   7. SERVICE POINT LAYERS (Hospitals, Schools, Banks, Parks, Bus Stops)
   ------------------------------------------------------------------------- */
function makeServiceIcon(layerKey) {
  const s = SERVICE_STYLE[layerKey];
  return L.divIcon({
    className: 'service-marker',
    html: `<div style="
        background:${s.color};
        width:22px;height:22px;border-radius:50%;
        display:flex;align-items:center;justify-content:center;
        color:#fff;font-size:12px;font-weight:700;
        border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,0.35);
      ">${s.glyph}</div>`,
    iconSize: [22, 22],
    iconAnchor: [11, 11],
    popupAnchor: [0, -11]
  });
}

function buildServicePopupHtml(layerKey, props) {
  const s = SERVICE_STYLE[layerKey];
  const name = props.name || props.NAME || props.Name || s.label;
  let rows = '';
  Object.entries(props || {}).forEach(([k, v]) => {
    if (v === null || v === undefined || v === '') return;
    rows += `<div class="popup-row"><span class="k">${k}</span><span class="v">${v}</span></div>`;
  });
  return `
    <div class="popup-title">${name}</div>
    ${rows || '<p style="color:#647089;font-size:12px;margin:0;">No additional attributes.</p>'}
    <span class="info-badge" style="background:${s.color}">${s.label}</span>
  `;
}

function loadServiceLayer(layerKey, geojson) {
  const group = L.layerGroup();

  const features = geojson.features || [];
  features.forEach(feature => {
    if (!feature.geometry) return;
    const coordsHandler = (latlng) => L.marker(latlng, { icon: makeServiceIcon(layerKey) });
    const layer = L.geoJSON(feature, { pointToLayer: (f, latlng) => coordsHandler(latlng) });
    layer.eachLayer(l => {
      l.bindPopup(buildServicePopupHtml(layerKey, feature.properties || {}));
      group.addLayer(l);
    });
  });

  serviceLayers[layerKey] = group;
  serviceCounts[layerKey] = features.length;
  group.addTo(map);

  // Update sidebar counters + dashboard stats
  const countEl = document.getElementById(`count-${layerKey}`);
  if (countEl) countEl.textContent = features.length;
  const statEl = document.getElementById(`stat${layerKey}`);
  if (statEl) statEl.textContent = features.length;
}

// Checkbox toggling for each service layer
document.querySelectorAll('#serviceLayerList input[type="checkbox"]').forEach(cb => {
  cb.addEventListener('change', () => {
    const key = cb.dataset.layer;
    const layer = serviceLayers[key];
    if (!layer) return;
    if (cb.checked) {
      map.addLayer(layer);
    } else {
      map.removeLayer(layer);
    }
  });
});

/* -------------------------------------------------------------------------
   8. SEARCH (GN Division by name)
   ------------------------------------------------------------------------- */
const searchInput = document.getElementById('gnSearchInput');
const suggestionsBox = document.getElementById('searchSuggestions');

function renderSuggestions(matches) {
  suggestionsBox.innerHTML = '';
  if (matches.length === 0) {
    suggestionsBox.innerHTML = '<div class="no-results">No matching GN Division</div>';
    suggestionsBox.hidden = false;
    return;
  }
  matches.slice(0, 8).forEach(feature => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = feature.properties[FIELD.name];
    btn.addEventListener('click', () => selectSearchResult(feature));
    suggestionsBox.appendChild(btn);
  });
  suggestionsBox.hidden = false;
}

function selectSearchResult(feature) {
  suggestionsBox.hidden = true;
  searchInput.value = feature.properties[FIELD.name];

  if (!gnLayer) return;
  gnLayer.eachLayer(layer => {
    if (layer.feature === feature) {
      if (selectedLayer) gnLayer.resetStyle(selectedLayer);
      selectedLayer = layer;
      layer.setStyle({ weight: 3, color: '#10233f', fillOpacity: 0.9 });
      map.fitBounds(layer.getBounds(), { maxZoom: 15 });
      layer.openPopup();
      updateInfoPanel(feature.properties || {});
    }
  });
}

searchInput.addEventListener('input', () => {
  const q = searchInput.value.trim().toLowerCase();
  if (q.length === 0) {
    suggestionsBox.hidden = true;
    return;
  }
  const matches = allGnFeatures.filter(f =>
    (f.properties?.[FIELD.name] || '').toLowerCase().includes(q)
  );
  renderSuggestions(matches);
});

document.addEventListener('click', (e) => {
  if (!e.target.closest('.search-box')) suggestionsBox.hidden = true;
});

/* -------------------------------------------------------------------------
   9. SIDEBAR TOGGLE (mobile / small screens)
   ------------------------------------------------------------------------- */
document.getElementById('sidebarToggle').addEventListener('click', () => {
  document.getElementById('sidebar').classList.toggle('open');
});

/* -------------------------------------------------------------------------
   10. DATA LOADING
   ------------------------------------------------------------------------- */
async function fetchGeoJson(path) {
  const res = await fetch(encodeURI(path));
  if (!res.ok) throw new Error(`Failed to load ${path} (HTTP ${res.status})`);
  return res.json();
}

async function init() {
  setMapStatus('Loading GN Division boundaries…');
  try {
    const gnData = await fetchGeoJson(DATA_FILES.gn);
    loadGnLayer(gnData);
  } catch (err) {
    console.error(err);
    setMapStatus('Could not load Accessibility Index.geojson — check /data folder.');
    return;
  }

  const pointLayers = ['Hospitals', 'Schools', 'Banks', 'Parks', 'BusStops'];
  for (const key of pointLayers) {
    setMapStatus(`Loading ${SERVICE_STYLE[key].label} layer…`);
    try {
      const data = await fetchGeoJson(DATA_FILES[key]);
      loadServiceLayer(key, data);
    } catch (err) {
      console.warn(`Skipping ${key}:`, err.message);
      const countEl = document.getElementById(`count-${key}`);
      if (countEl) countEl.textContent = '0';
    }
  }

  setMapStatus('All layers loaded.', true);
}

init();
