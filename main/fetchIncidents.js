const res = await fetch("https://purple-hall-7383.henry-walen.workers.dev/");
const { fire, service } = await res.json();

const fireData = fire;
const serviceData = service;

console.log("FIRE:", fireData);
console.log("SERVICE:", serviceData);

// map
const map = L.map('map').setView([37.7749, -122.4194], 13);
L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
  attribution: '&copy; CARTO Base Dark All',
  maxZoom: 19
}).addTo(map);

// pins
const severityColor = {
  '1': '#d73027', '2': '#fc8d59', '3': '#feb224',      // Fire dataset
  'A': '#d73027', 'B': '#fc8d59', 'C': '#feb224'       // Service dataset
};
const colorForFire = p => severityColor[p.priority] ?? '#9aa0a6';
const colorForSvc  = p => severityColor[p.priority_final || p.priority_original] ?? '#9aa0a6';

// Layers
const fireLayer = L.geoJSON(fireData, {
  pointToLayer: (feature, latlng) => {
    const c = colorForFire(feature.properties);
    return L.circleMarker(latlng, { radius: 6, color: c, fillColor: c, weight: 1, opacity: 1, fillOpacity: 0.85 });
  },
  // FIRE
  onEachFeature: (feature, layer) => {
    const p = feature.properties;
    const c = colorForFire(p);
    p.address = p.address.replace(/\\/g, '&');
    layer.bindPopup(`
      <strong style="color:${c}">${escapeHtml(p.call_type)}</strong> — ${escapeHtml(p.call_final_disposition ?? '—')}<br/>
      <em>${escapeHtml(p.address ?? 'Address n/a')}</em><br/>
      Received: ${escapeHtml(p.received_dttm)}<br/>
      Priority: ${escapeHtml(p.priority ?? '—')}
    `);
  }

}).addTo(map);

const serviceLayer = L.geoJSON(serviceData, {
  pointToLayer: (feature, latlng) => {
    const c = colorForSvc(feature.properties);
    return L.circleMarker(latlng, { radius: 6, color: c, fillColor: c, weight: 1, opacity: 1, fillOpacity: 0.85 });
  },
  // SERVICE
  onEachFeature: (feature, layer) => {
    const p = feature.properties;
    const c = colorForSvc(p);
    p.intersection_name = p.intersection_name.replace(/\\/g, '&');
    layer.bindPopup(`
      <strong style="color:${c}">${escapeHtml(p.call_type_final_desc ?? p.call_type_final ?? 'Call')}</strong><br/>
      <em>${escapeHtml(p.intersection_name ?? 'Location n/a')}</em><br/>
      Received: ${escapeHtml(p.received_datetime)}<br/>
      Call Notes: ${escapeHtml(p.call_type_final_notes ?? "None")}<br/>
      Priority: ${escapeHtml(p.priority_final ?? p.priority_original ?? '—')}<br/>
      Agency: ${escapeHtml(p.agency ?? '—')}
    `);
  }

}).addTo(map);

// Fit map
let fitBoundsDone = false;
if (fireData.features?.length) {
  map.fitBounds(fireLayer.getBounds(), { padding: [20, 20] });
  fitBoundsDone = true;
}
if (serviceData.features?.length) {
  const b = serviceLayer.getBounds();
  map.fitBounds(fitBoundsDone ? map.getBounds().extend(b) : b, { padding: [20, 20] });
}

// Sidebar
const sidebar = document.querySelector('.sidebar');
sidebar.style.display = 'flex';
sidebar.style.flexDirection = 'column';
sidebar.style.height = '100%';
sidebar.innerHTML = `<div id="incident-list" style="overflow:auto; flex:1; padding:0px; color: #b4b4b4; background-color: black;"></div>`;
const listEl = document.getElementById('incident-list');

// Helper methods
const toDate = s => { const d = new Date(s); return isNaN(d) ? null : d; };
const fmt = d => d ? d.toLocaleString() : '—';

function latestTimestampFrom(features, fields) {
  let max = null;
  for (const f of (features || [])) {
    const p = f?.properties || {};
    for (const field of fields) {
      const v = p[field];
      if (!v) continue;
      const d = toDate(v);
      if (!d) continue;
      if (!max || d > max) max = d;
    }
  }
  return max;
}

// Prefer data_as_of from either dataset; fallback to newest received time
const lastUpdatedFromData =
  latestTimestampFrom(fireData.features, ['data_as_of']) ||
  latestTimestampFrom(serviceData.features, ['data_as_of']) ||
  latestTimestampFrom(fireData.features, ['received_dttm']) ||
  latestTimestampFrom(serviceData.features, ['received_datetime']) ||
  null;

// combine FIRE and SERVICE on map
const items = [];
const markerByKey = new Map();

function featureKey(source, f) {
  const coords = f.geometry?.coordinates ?? [];
  const p = f.properties ?? {};
  const when = p.received_dttm ?? p.received_datetime ?? p.data_as_of ?? '';
  return `${source}:${coords.join(',')}:${when}`;
}
function pushFromLayer(source, layer, toRow) {
  layer.eachLayer(mk => {
    const f = mk.feature;
    if (!f) return;
    const key = featureKey(source, f);
    markerByKey.set(key, mk);
    const row = toRow(f.properties, key);
    if (row) items.push(row);
    mk.on('click', () => highlightByKey(key));
  });
}

// Fire rows
pushFromLayer('F', fireLayer, (p, key) => ({
  key,
  time: toDate(p.received_dttm),
  title: p.call_type ?? 'Fire Call',
  notes: p.call_type_final_notes ?? null,
  loc: p.address ?? 'Location n/a',
  neighborhood: p.analysis_neighborhood ?? p.neighborhood_district ?? null,
  priority: p.priority ?? '—',
  agency: null,
  color: colorForFire(p)          // <-- add this
}));

// Service rows
pushFromLayer('S', serviceLayer, (p, key) => ({
  key,
  time: toDate(p.received_datetime),
  title: p.call_type_final_desc ?? p.call_type_final ?? 'Service Call',
  notes: p.call_type_final_notes ?? null,
  loc: p.intersection_name ?? 'Location n/a',
  neighborhood: p.analysis_neighborhood ?? p.neighborhood_district ?? null,
  priority: p.priority_final ?? p.priority_original ?? '—',
  agency: p.agency ?? null,
  color: colorForSvc(p)           // <-- and this
}));

items.sort((a, b) => (b.time?.getTime() ?? 0) - (a.time?.getTime() ?? 0));

// Data summary
const fireCount = fireData.features?.length ?? 0;
const policeCount = serviceData.features?.length ?? 0;

function renderHeader() {
  const header = document.createElement('div');
  header.style.cssText = `
    padding:10px; border-bottom:2px solid #1f1f1f; margin-bottom:2px; text-align:left;
    font-size: 13px; line-height:1.4;
  `;
  const updatedText = lastUpdatedFromData ? fmt(lastUpdatedFromData) : '—';

  header.innerHTML = `
    <div style="font-weight:900; margin-bottom:4px; opacity: 1;">STATS</div>
    <div style="font-weight:700; margin-bottom:4px; opacity: 0.85;">Calls in the past 3 hours</div>
    <div style="opacity:0.85;">Fire: ${fireCount} &nbsp;·&nbsp; Police: ${policeCount}</div>
    <div style="opacity:0.7; font-size:12px; margin-top:2px;">Last updated: ${escapeHtml(updatedText)}</div>
  `;
  listEl.appendChild(header);
}

// item rows

function renderList(rows) {
  listEl.innerHTML = '';     // clear
  renderHeader();            // add summary at top

  for (const r of rows) {
    r.loc = r.loc.replace(/\\/g, '&')
    const el = document.createElement('div');
    el.className = 'incident-item';
    el.dataset.key = r.key;
    el.style.cssText = `
      padding:10px; border-bottom:1px solid #1f1f1f; cursor:pointer; text-align:left;
    `;

    el.innerHTML = `
      <div style="font-weight:600; margin-bottom:2px; color:${r.color};">
        ${escapeHtml(r.title)}
      </div>
      ${r.notes ? `<div style="font-size:12px; opacity:0.8; margin:-2px 0 4px 0;">Call Notes: ${escapeHtml(r.notes)}</div>` : ``}
      <div style="font-size:12px; opacity:0.85; margin-bottom:2px;">${escapeHtml(r.loc)}</div>
      ${r.neighborhood ? `<div style="font-size:12px; opacity:0.85; margin-bottom:2px;">Neighborhood: ${escapeHtml(r.neighborhood)}</div>` : ``}
      <div style="font-size:12px; opacity:0.7; margin-bottom:4px;">${escapeHtml(fmt(r.time))}</div>
      <div style="font-size:12px; opacity:0.85;">Priority: ${escapeHtml(String(r.priority))}${r.agency ? ` · ${escapeHtml(r.agency)}` : ''}</div>
      `;


    el.addEventListener('click', () => {
      const mk = markerByKey.get(r.key);
      if (mk) {
        map.flyTo(mk.getLatLng(), 15, { duration: 0.5 });
        mk.openPopup();
        highlight(el);
      }
    });

    listEl.appendChild(el);
  }
}

function highlight(rowEl) {
  listEl.querySelectorAll('.incident-item').forEach(n => n.style.background = '');
  rowEl.style.background = 'rgba(255,255,255,0.06)';
  rowEl.scrollIntoView({ block: 'nearest' });
}
function highlightByKey(key) {
  const el = listEl.querySelector(`.incident-item[data-key="${cssEscape(key)}"]`);
  if (el) highlight(el);
}

const topRightText = L.control({ position: 'topright' });

topRightText.onAdd = function () {
  const div = L.DomUtil.create('div', 'map-topright-text');
  const updatedText = lastUpdatedFromData ? fmt(lastUpdatedFromData) : '—';
  div.style.cssText = `
    color:#fff;
    padding:8px 10px; border-radius:10px;
    font-size:19px; line-height:1.2; font-weight:700;
    margin:5px;
    text-align: right;
  `;
  div.innerHTML = `
    LIVE 911 RADAR<br/>
    <span style="font-size:16px; font-weight:500; opacity:.85">By <a href="https://cs.du.edu/~henwalen">Henry Walen</a></span>
  `;
  return div;
};

topRightText.addTo(map);

function escapeHtml(s) {
  return String(s ?? '')
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;').replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
function cssEscape(s) { return String(s).replace(/"/g, '\\"'); }

renderList(items);
