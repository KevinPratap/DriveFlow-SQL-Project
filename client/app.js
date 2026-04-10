const API_BASE = 'http://localhost:3001/api/v1';

// App State
let state = {
    user: JSON.parse(localStorage.getItem('df_user')) || null,
    drivers: [],
    selectedDriver: null,
    pickupPos: null,
    dropoffPos: null,
    pickupAddr: '',
    dropoffAddr: '',
    baseFare: 50.00,
    fare: 0,
    distance: 0,
    activeView: 'book',
    lastLogJSON: ''
};

// Map State
let map, pickupMarker, dropoffMarker;

// Selectors
const els = {
    driverList: document.getElementById('driverList'),
    ridesHistory: document.getElementById('ridesHistory'),
    bookBtn: document.getElementById('bookSubmitBtn'),
    fareEl: document.getElementById('estimatedFare'),
    userDisplay: document.getElementById('userProfile'),
    loginModal: document.getElementById('loginModal'),
    pickupInput: document.getElementById('pickup'),
    dropoffInput: document.getElementById('dropoff'),
    navBtns: document.querySelectorAll('.nav-btn'),
    views: document.querySelectorAll('.view')
};

// --- Initialization ---
document.addEventListener('DOMContentLoaded', () => {
    initMap();
    initUI();
    fetchDrivers();
    // Support typing for manual input (Functional fallback)
    els.pickupInput.addEventListener('input', debounce((e) => {
        fetchSuggestions(e.target.value, 'pickup');
    }, 500));

    els.dropoffInput.addEventListener('input', debounce((e) => {
        fetchSuggestions(e.target.value, 'dropoff');
    }, 500));

    // DBMS Management Listeners
    document.getElementById('driverForm').addEventListener('submit', registerDriver);

    // Close results on outside click
    document.addEventListener('click', (e) => {
        if (!e.target.closest('.input-wrapper')) {
            document.querySelectorAll('.search-results').forEach(r => r.classList.remove('active'));
        }
    });

    // Core Actions
    els.bookBtn.addEventListener('click', bookRide);

    // Start SQL Engine Monitoring
    setInterval(pollEngineLogs, 2000);
    fetchLiveTables();

    // Initial Toggle Setup
    document.querySelector('.console-header').onclick = toggleConsole;
});

// --- View Rendering ---
function switchView(view) {
    document.querySelectorAll('.app-view, .view').forEach(v => v.classList.add('hidden'));
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    
    // Highlight btn
    const targetBtn = Array.from(document.querySelectorAll('.nav-btn'))
        .find(b => b.textContent.toLowerCase().includes(view === 'schema' ? 'diagram' : view));
    if (targetBtn) targetBtn.classList.add('active');

    // Handle full screens
    if (view === 'schema') {
        document.getElementById('view-schema').style.display = 'flex';
        document.getElementById('map').style.display = 'none';
        document.querySelectorAll('.app-view').forEach(v => v.classList.add('hidden'));
    } else {
        document.getElementById('view-schema').style.display = 'none';
        document.getElementById('map').style.display = 'block';
    }

    if (view === 'booking') document.getElementById('view-booking').classList.remove('hidden');
    if (view === 'history') {
        document.getElementById('view-history').classList.remove('hidden');
        fetchHistory();
    }
    if (view === 'drivers') {
        document.getElementById('view-drivers').classList.remove('hidden');
        fetchFleet();
    }
}

// --- Live Search Engine ---

function debounce(func, wait) {
    let timeout;
    return (...args) => {
        clearTimeout(timeout);
        timeout = setTimeout(() => func(...args), wait);
    };
}

async function fetchSuggestions(query, type) {
    const resultsEl = document.getElementById(`${type}Results`);
    if (query.length < 3) {
        resultsEl.classList.remove('active');
        return;
    }

    try {
        // Bias results to current map center (Mumbai)
        const center = map.getCenter();
        const res = await fetch(`https://photon.komoot.io/api/?q=${encodeURIComponent(query)}&lat=${center.lat}&lon=${center.lng}&limit=10`);
        const data = await res.json();
        renderSuggestions(data.features, type);
    } catch (err) {
        console.error('Search error:', err);
    }
}

function renderSuggestions(features, type) {
    const resultsEl = document.getElementById(`${type}Results`);
    if (features.length === 0) {
        resultsEl.innerHTML = '<div class="search-item">No locations found.</div>';
    } else {
        resultsEl.innerHTML = features.map(f => {
            const p = f.properties;
            const name = p.name || p.street || 'Unnamed Location';
            const sub = [p.city, p.district, p.state].filter(Boolean).join(', ');
            const lat = f.geometry.coordinates[1];
            const lon = f.geometry.coordinates[0];
            const fullAddr = `${name}, ${sub}`.replace(/'/g, "\\'");

            return `
                <div class="search-item" onclick="selectSuggestion('${lat}', '${lon}', '${fullAddr}', '${type}')">
                    <span class="main-text">${name}</span>
                    <span class="sub-text">${sub}</span>
                </div>
            `;
        }).join('');
    }
    resultsEl.classList.add('active');
}

function selectSuggestion(lat, lon, addr, type) {
    const latlng = L.latLng(parseFloat(lat), parseFloat(lon));
    const input = document.getElementById(type);
    const resultsEl = document.getElementById(`${type}Results`);

    input.value = addr;
    resultsEl.classList.remove('active');

    if (type === 'pickup') {
        setPickup(latlng, addr);
        map.panTo(latlng);
    } else {
        setDropoff(latlng, addr);
        map.panTo(latlng);
    }
}

// --- Map Logic ---

function getAreaName(lat, lng) {
    // Mock reverse geocoder for Mumbai neighborhoods to ensure "Accuracy"
    if (lat > 19.18) return "Borivali, Mumbai";
    if (lat > 19.12) return "Andheri, Mumbai";
    if (lat > 19.08) return "Juhu, Mumbai";
    if (lat > 19.05) return "Bandra, Mumbai";
    if (lat > 19.02) return "Dadar, Mumbai";
    return "Colaba, Mumbai";
}

function initMap() {
    const mumbai = [19.0760, 72.8777];
    map = L.map('map', { zoomControl: false }).setView(mumbai, 12);

    L.tileLayer('http://{s}.google.com/vt/lyrs=m&x={x}&y={y}&z={z}', {
        maxZoom: 20,
        subdomains: ['mt0', 'mt1', 'mt2', 'mt3'],
        attribution: '&copy; Google Maps'
    }).addTo(map);

    L.control.zoom({ position: 'topright' }).addTo(map);

    map.on('click', (e) => {
        if (!state.pickupPos) {
            setPickup(e.latlng);
        } else if (!state.dropoffPos) {
            setDropoff(e.latlng);
        }
    });
}

function setPickup(latlng, addr) {
    state.pickupPos = latlng;
    state.pickupAddr = addr || getAreaName(latlng.lat, latlng.lng);
    els.pickupInput.value = state.pickupAddr;
    
    if (pickupMarker) map.removeLayer(pickupMarker);
    pickupMarker = L.marker(latlng, { icon: L.icon({
        iconUrl: 'https://cdn-icons-png.flaticon.com/512/684/684908.png',
        iconSize: [32, 32]
    }) }).addTo(map);
    updateFare();
}

function setDropoff(latlng, addr) {
    state.dropoffPos = latlng;
    state.dropoffAddr = addr || getAreaName(latlng.lat, latlng.lng);
    els.dropoffInput.value = state.dropoffAddr;

    if (dropoffMarker) map.removeLayer(dropoffMarker);
    dropoffMarker = L.marker(latlng).addTo(map);
    updateFare();
}

function initUI() {
    if (state.user) {
        els.userDisplay.innerHTML = `
            <span class="user-name">Hi, ${state.user.name.split(' ')[0]}</span> 
            <button onclick="logout()" class="btn-logout">Logout</button>
        `;
    } else {
        els.userDisplay.innerHTML = `
            <span class="user-name">Guest</span>
            <button id="loginBtn" class="btn-auth" onclick="toggleLogin(true)">Login</button>
        `;
    }
}

// --- API Calls ---

async function fetchDrivers() {
    try {
        const res = await fetch(`${API_BASE}/drivers`);
        state.drivers = await res.json();
        renderDrivers();
    } catch (err) { console.error('Drivers fail:', err); }
}

async function fetchHistory() {
    if (!state.user) return;
    const cid = state.user.customer_id || state.user.id;
    try {
        const res = await fetch(`${API_BASE}/history/${cid}`);
        const history = await res.json();
        renderHistory(history);
    } catch (err) { console.error('History fail:', err); }
}

// --- Actions ---

function calculateFare(driver, distance = 0) {
    const type = driver.type || 'standard';
    const multiplier = type.toLowerCase() === 'luxury' ? 2 : (type.toLowerCase() === 'suv' ? 1.5 : 1);
    const driverOffset = (driver.driver_id * 7) % 25; 
    const baseWithDist = state.baseFare + (distance * 15);
    return Math.round((baseWithDist * multiplier) + driverOffset);
}

function renderDrivers() {
    const icons = { 'sedan': '🚗', 'suv': '🚙', 'luxury': '💎' };
    const dist = (state.pickupPos && state.dropoffPos) ? state.pickupPos.distanceTo(state.dropoffPos) / 1000 : 0;
    
    els.driverList.innerHTML = state.drivers.map(d => {
        const fare = calculateFare(d, dist);
        const type = d.type || 'standard';
        return `
            <div class="vehicle-card ${state.selectedDriver?.driver_id === d.driver_id ? 'selected' : ''}" 
                onclick="selectDriver(${d.driver_id})">
                <span class="vehicle-icon">${icons[type.toLowerCase()] || '🚕'}</span>
                <div class="vehicle-info">
                    <h4>${type.toUpperCase()} // ${d.driver_name}</h4>
                    <p>⭐ ${d.rating || '5.0'} • ${d.model}</p>
                </div>
                <span class="vehicle-price">₹${fare}</span>
            </div>
        `;
    }).join('') || '<p>No drivers in range.</p>';
}

function selectDriver(id) {
    state.selectedDriver = state.drivers.find(d => d.driver_id === id);
    renderDrivers();
    updateFare();
    validateForm();
}

function updateFare() {
    if (state.pickupPos && state.dropoffPos) {
        const dist = state.pickupPos.distanceTo(state.dropoffPos) / 1000;
        const total = state.selectedDriver ? calculateFare(state.selectedDriver, dist) : Math.round(state.baseFare + (dist * 15));
        state.fare = total;
        state.distance = dist;
        els.fareEl.innerText = `₹${total}`;
    }
    validateForm();
}

function validateForm() {
    const ready = state.user && state.selectedDriver && state.pickupPos && state.dropoffPos;
    els.bookBtn.disabled = !ready;
    if (!state.user && state.selectedDriver) toggleLogin(true);
}

// --- Submit Booking ---
async function bookRide() {
    if (!state.user) return alert('Please Login first');
    if (!state.pickupPos || !state.dropoffPos || !state.selectedDriver) return;

    animateNode('node-bookings');
    
    const cid = state.user.customer_id || state.user.id;
    try {
        const res = await fetch(`${API_BASE}/bookings`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                customerId: cid,
                driverId: state.selectedDriver.driver_id,
                pickup: state.pickupAddr,
                dropoff: state.dropoffAddr,
                fare: state.fare,
                distance: state.distance
            })
        });
        const data = await res.json();
        if (data.success || data.id) {
            alert('Booking Successful!');
            resetBooking();
            switchView('history');
        } else {
            alert('Booking failed: ' + (data.error || 'Check Database Connection'));
        }
    } catch (err) {
        alert('Booking Error: ' + err.message);
    }
}

// --- DBMS Management ---

async function fetchFleet() {
    try {
        const res = await fetch(`${API_BASE}/fleet`);
        const drivers = await res.json();
        const list = document.getElementById('fleetList');
        list.innerHTML = `
            <table class="fleet-table">
                <thead><tr><th>Name</th><th>Model</th><th>Plate</th><th>Status</th></tr></thead>
                <tbody>
                    ${drivers.map(d => `
                        <tr>
                            <td>${d.driver_name}</td>
                            <td>${d.model}</td>
                            <td>${d.number_plate}</td>
                            <td><span class="badge status-${d.availability_status}">${d.availability_status}</span></td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        `;
    } catch (err) { console.error('Fleet fail:', err); }
}

async function registerDriver(e) {
    e.preventDefault();
    const data = {
        name: document.getElementById('d_name').value,
        phone: document.getElementById('d_phone').value,
        license: document.getElementById('d_license').value,
        model: document.getElementById('v_model').value,
        plate: document.getElementById('v_plate').value,
        type: document.getElementById('v_type').value
    };
    try {
        const res = await fetch(`${API_BASE}/fleet/register`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        const result = await res.json();
        if (result.success) {
            alert('Driver Registered!');
            e.target.reset();
            fetchFleet();
        }
    } catch (err) { console.error('Register fail:', err); }
}

async function pollEngineLogs() {
    try {
        const res = await fetch(`${API_BASE}/engine/logs`);
        const logs = await res.json();
        const currentJSON = JSON.stringify(logs);
        if (currentJSON === state.lastLogJSON) return;
        
        // --- Live ER Animation ---
        if (state.lastLogJSON) {
            const oldLogsJSON = JSON.parse(state.lastLogJSON);
            const newLogs = logs.filter(l => !oldLogsJSON.some(ol => ol.timestamp === l.timestamp && ol.query === l.query));
            newLogs.forEach(l => {
                const q = l.query.toLowerCase();
                if (q.includes('users')) animateNode('node-users');
                if (q.includes('drivers')) animateNode('node-drivers');
                if (q.includes('vehicles')) animateNode('node-vehicles');
                if (q.includes('bookings')) animateNode('node-bookings');
                if (q.includes('trips')) animateNode('node-trips');
                if (q.includes('payments')) animateNode('node-payments');
            });
        }

        state.lastLogJSON = currentJSON;
        const logEl = document.getElementById('sqlLog');
        logEl.innerHTML = logs.map(l => `<div><span style="color:#64748b; font-size:12px; margin-right:8px">[${l.timestamp}]</span><span class="sql-highlight">SQL:</span><span class="sql-query">${l.query}</span></div>`).join('');
        logEl.scrollTop = logEl.scrollHeight;

        // Sync Live Tables
        fetchLiveTables();
    } catch (err) { }
}

// --- Live Tables Rendering ---
let liveTablesData = {};

async function fetchLiveTables() {
    try {
        const res = await fetch(`${API_BASE}/database/tables`);
        liveTablesData = await res.json();
        renderLiveTables();
    } catch(err) {} 
}

window.renderLiveTables = function() {
    const filter = document.getElementById('tableSelector')?.value || 'all';
    const container = document.getElementById('liveTablesContainer');
    if (!container) return;
    
    let html = '';
    for (const [tableName, rows] of Object.entries(liveTablesData)) {
        // Build generic HTML table for both widget and SVG node
        let tableHtml = '';
        if (rows.length === 0) {
            tableHtml = `<div style="padding:12px; font-size:12px; color:var(--text-muted); text-align:center;">No entries yet.</div>`;
        } else {
            const cols = Object.keys(rows[0]);
            tableHtml += `<table class="fleet-table" style="font-size:11px; width:100%; border-collapse:collapse;">`;
            tableHtml += `<thead><tr>${cols.map(c => {
                let badge = '';
                if (c === 'id' || c === tableName.replace(/s$/,'')+'_id') badge = '🔑 ';
                else if (c.endsWith('_id') || c === 'customer_id') badge = '🔗 ';
                return `<th style="padding:4px; border-bottom:2px solid var(--slate-200); text-align:left; white-space:nowrap;">${badge}${c}</th>`;
            }).join('')}<th style="padding:4px; border-bottom:2px solid var(--slate-200);">Act</th></tr></thead>`;
            tableHtml += `<tbody>`;
            rows.forEach(r => {
                const pkValue = r[cols[0]];
                tableHtml += `<tr>${cols.map(c => `<td style="padding:4px; border-bottom:1px solid var(--slate-100); color:var(--slate-800); white-space:nowrap;">${r[c]}</td>`).join('')}<td style="padding:4px; border-bottom:1px solid var(--slate-100);"><button onclick="deleteRow('${tableName}', ${pkValue})" style="color:var(--error); cursor:pointer; font-weight:700; background:none; border:none; padding:2px;">X</button></td></tr>`;
            });
            tableHtml += `</tbody></table>`;
        }

        // 1. Inject into standard Widget if filter matches
        if (filter === 'all' || filter === tableName) {
            html += `<div style="background:var(--slate-50); padding:8px 12px; font-weight:700; font-size:12px; border-bottom:1px solid var(--slate-200); position:sticky; top:0; z-index:10; text-transform:uppercase;">Table: ${tableName} <span style="color:var(--primary);float:right;">${rows.length} rows</span></div>`;
            html += tableHtml;
        }

        // 2. Inject into Fullscreen ER Diagram Nodes
        const fsTable = document.getElementById(`fs-table-${tableName}`);
        if (fsTable) {
            // Re-use table HTML but optimized for the SVG canvas
            fsTable.innerHTML = tableHtml;
        }
    }
    container.innerHTML = html || '<div style="padding:12px; font-size:12px; color:var(--text-muted); text-align:center;">No tables found.</div>';
}

window.deleteRow = async function(table, id) {
    if(!confirm(`WARNING: Deleting row #${id} from [${table}]. This may cascade or fail due to constraints. Proceed?`)) return;
    try {
        const res = await fetch(`${API_BASE}/database/tables/${table}/${id}`, { method: 'DELETE' });
        if(res.ok) fetchLiveTables();
        else {
            const err = await res.json();
            alert('Failed to delete: ' + err.error);
        }
    } catch(e) { console.error(e); }
}

function animateNode(id) {
    const node = document.getElementById(id);
    if (!node) return;
    node.classList.add('active');
    setTimeout(() => node.classList.remove('active'), 1500);
}

// --- UI Helpers ---

function toggleSidebar() {
    const sb = document.getElementById('mainSidebar');
    sb.classList.toggle('collapsed');
    const btn = document.getElementById('sidebarToggle');
    if (sb.classList.contains('collapsed')) {
        btn.textContent = '▶';
    } else {
        btn.textContent = '◀';
    }
    // Must update bounds for map/canvas
    setTimeout(() => { if (typeof map !== 'undefined') map.invalidateSize(); }, 300);
}

function toggleConsole() {
    const con = document.getElementById('sql-console');
    con.classList.toggle('minimized');
    const btn = document.getElementById('btnMinimizeConsole');
    if (btn) btn.textContent = con.classList.contains('minimized') ? 'Maximize' : 'Minimize';
    setTimeout(() => map.invalidateSize(), 300);
}

function toggleWidget(id) {
    document.getElementById(id).classList.toggle('minimized');
}

function resetBooking() {
    state.pickupPos = null; state.dropoffPos = null; state.selectedDriver = null;
    if (pickupMarker) map.removeLayer(pickupMarker);
    if (dropoffMarker) map.removeLayer(dropoffMarker);
    els.pickupInput.value = ''; els.dropoffInput.value = '';
    els.fareEl.innerText = '₹0.00';
    renderDrivers();
}

function toggleLogin(show) { show ? els.loginModal.classList.add('active') : els.loginModal.classList.remove('active'); }

let isRegisterMode = false;

window.toggleAuthMode = function(e) {
    if(e) e.preventDefault();
    isRegisterMode = !isRegisterMode;
    const fields = document.getElementById('registerFields');
    const title = document.getElementById('authTitle');
    const btn = document.getElementById('authSubmitBtn');
    const toggleBtn = document.getElementById('toggleAuthModeBtn');

    if (isRegisterMode) {
        fields.classList.remove('hidden');
        title.innerText = 'Create Account';
        btn.innerText = 'Sign Up';
        toggleBtn.innerText = 'Already have an account? Log In';
        document.getElementById('regName').required = true;
    } else {
        fields.classList.add('hidden');
        title.innerText = 'Welcome Back';
        btn.innerText = 'Log In';
        toggleBtn.innerText = "Don't have an account? Register";
        document.getElementById('regName').required = false;
    }
}

document.getElementById('loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('loginEmail').value;
    const password = document.getElementById('loginPass').value;
    
    let endpoint = `${API_BASE}/auth/login`;
    let body = { email, password };

    if (isRegisterMode) {
        endpoint = `${API_BASE}/auth/register`;
        body.name = document.getElementById('regName').value;
        body.phone = document.getElementById('regPhone').value || '';
    }

    const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    });

    if (res.ok) {
        const data = await res.json();
        localStorage.setItem('df_user', JSON.stringify(data));
        toggleLogin(false);
        state.user = data;
        initUI();
        validateForm();
        if(isRegisterMode) alert('Registration successful! You are logged in.');
    } else { 
        const err = await res.json();
        alert(err.error || 'Authentication Failed'); 
    }
});

function logout() { localStorage.removeItem('df_user'); location.reload(); }

function renderHistory(rides) {
    els.ridesHistory.innerHTML = rides.map(r => {
        // NO FALLBACKS - Show what is strictly in the DB
        const fare = r.fare || 0;
        return `
            <div class="history-item">
                <div class="route">${r.pickup_location} → ${r.dropoff_location}</div>
                <div class="meta">
                    <span>${r.driver_name} (${r.status})</span>
                    <span>₹${Number(fare)}</span>
                </div>
            </div>
        `;
    }).join('') || '<p>No trip history.</p>';
}

function animateNode(id) {
    // Also try fullscreen node if available
    let node = document.getElementById(id);
    if (!node) node = document.querySelector(`.draggable-node[data-id="${id.replace('node-','')}"] rect`);
    if (!node) return;
    node.classList.add('flash');
    setTimeout(() => node.classList.remove('flash'), 1000);
}

// --- Interactive ER Diagram Drag & Drop ---
let dragState = { active: false, node: null, offsetX: 0, offsetY: 0 };
document.querySelectorAll('.draggable-node').forEach(node => {
    node.style.cursor = 'grab';
    node.addEventListener('mousedown', (e) => {
        dragState.active = true;
        dragState.node = node;
        node.style.cursor = 'grabbing';
        
        const transform = node.getAttribute('transform');
        const match = /translate\(([^,]+),\s*([^\)]+)\)/.exec(transform);
        let currentX = match ? parseFloat(match[1]) : 0;
        let currentY = match ? parseFloat(match[2]) : 0;

        const svg = document.getElementById('fullscreen-svg');
        const pt = svg.createSVGPoint();
        pt.x = e.clientX; pt.y = e.clientY;
        const svgP = pt.matrixTransform(svg.getScreenCTM().inverse());
        
        dragState.offsetX = svgP.x - currentX;
        dragState.offsetY = svgP.y - currentY;
    });
});

// --- SVG Pan & Zoom Mechanics ---
let panState = { active: false, startX: 0, startY: 0 };
let currentViewBox = { x: 0, y: 0, w: 1200, h: 800 };

document.getElementById('fullscreen-svg')?.addEventListener('mousedown', (e) => {
    if (!e.target.closest('.draggable-node')) {
        panState.active = true;
        panState.startX = e.clientX;
        panState.startY = e.clientY;
        document.getElementById('fullscreen-svg').style.cursor = 'grabbing';
    }
});

document.getElementById('fullscreen-svg')?.addEventListener('wheel', (e) => {
    e.preventDefault();
    const svg = document.getElementById('fullscreen-svg');
    const zoomFactor = 1.1;
    const isZoomIn = e.deltaY < 0;
    const f = isZoomIn ? (1 / zoomFactor) : zoomFactor;
    
    // Zoom toward mouse pointer
    const rect = svg.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    
    const svgX = currentViewBox.x + (mx / svg.clientWidth) * currentViewBox.w;
    const svgY = currentViewBox.y + (my / svg.clientHeight) * currentViewBox.h;
    
    const newW = currentViewBox.w * f;
    const newH = currentViewBox.h * f;
    
    currentViewBox.x = svgX - (mx / svg.clientWidth) * newW;
    currentViewBox.y = svgY - (my / svg.clientHeight) * newH;
    currentViewBox.w = newW;
    currentViewBox.h = newH;
    
    svg.setAttribute('viewBox', `${currentViewBox.x} ${currentViewBox.y} ${currentViewBox.w} ${currentViewBox.h}`);
}, { passive: false });

window.addEventListener('mousemove', (e) => {
    // Background Panning
    if (panState.active) {
        const svg = document.getElementById('fullscreen-svg');
        const dx = (e.clientX - panState.startX) * (currentViewBox.w / svg.clientWidth);
        const dy = (e.clientY - panState.startY) * (currentViewBox.h / svg.clientHeight);
        currentViewBox.x -= dx;
        currentViewBox.y -= dy;
        svg.setAttribute('viewBox', `${currentViewBox.x} ${currentViewBox.y} ${currentViewBox.w} ${currentViewBox.h}`);
        panState.startX = e.clientX;
        panState.startY = e.clientY;
        return;
    }

    if (!dragState.active || !dragState.node) return;
    
    const svg = document.getElementById('fullscreen-svg');
    const pt = svg.createSVGPoint();
    pt.x = e.clientX; pt.y = e.clientY;
    const svgP = pt.matrixTransform(svg.getScreenCTM().inverse());
    
    const newX = svgP.x - dragState.offsetX;
    const newY = svgP.y - dragState.offsetY;
    
    dragState.node.setAttribute('transform', `translate(${newX}, ${newY})`);
    
    if (window.globalRoutingUpdate) window.globalRoutingUpdate();
});

window.globalRoutingUpdate = () => {
    const updateE = (edgeId, fromId, toId) => {
        const edge = document.getElementById(edgeId);
        if(!edge) return;
        const getNodePos = (id) => {
            const n = document.querySelector(`.draggable-node[data-id="${id}"]`);
            if(!n) return null;
            const tf = n.getAttribute('transform');
            const m = /translate\(([^,]+),\s*([^\)]+)\)/.exec(tf);
            return { x: m ? parseFloat(m[1]) : 0, y: m ? parseFloat(m[2]) : 0 };
        };
        const p1 = getNodePos(fromId);
        const p2 = getNodePos(toId);
        if(!p1 || !p2) return;
        
        const center1 = { x: p1.x + 200, y: p1.y + 125 };
        const center2 = { x: p2.x + 200, y: p2.y + 125 };

        // Ray Bounding Box Intersection to snap edges to the perimeter flawlessly
        const getBorderPoint = (cx, cy, tx, ty, w, h) => {
            const dx = tx - cx;
            const dy = ty - cy;
            if (dx === 0 && dy === 0) return { x: cx, y: cy };
            
            const scaleX = (w / 2) / Math.abs(dx);
            const scaleY = (h / 2) / Math.abs(dy);
            const scale = Math.min(scaleX, scaleY);
            
            return { x: cx + dx * scale, y: cy + dy * scale };
        };

        const bp1 = getBorderPoint(center1.x, center1.y, center2.x, center2.y, 400 + 16, 250 + 16);
        const bp2 = getBorderPoint(center2.x, center2.y, center1.x, center1.y, 400 + 16, 250 + 16); // +16 pads for arrow thickness
        
        edge.setAttribute('x1', bp1.x);
        edge.setAttribute('y1', bp1.y);
        edge.setAttribute('x2', bp2.x);
        edge.setAttribute('y2', bp2.y);

        const lbl = document.getElementById(edgeId.replace('edge', 'label'));
        if (lbl) {
            lbl.setAttribute('x', (bp1.x + bp2.x) / 2);
            lbl.setAttribute('y', (bp1.y + bp2.y) / 2 - 10);
            if (fromId === 'drivers' && toId === 'bookings') {
                lbl.setAttribute('x', ((bp1.x + bp2.x) / 2) + 10);
                lbl.setAttribute('y', (bp1.y + bp2.y) / 2);
                lbl.setAttribute('text-anchor', 'start');
            }
        }
    };

    updateE('edge-users-bookings', 'users', 'bookings');
    updateE('edge-drivers-vehicles', 'drivers', 'vehicles');
    updateE('edge-drivers-bookings', 'drivers', 'bookings');
    updateE('edge-bookings-trips', 'bookings', 'trips');
    updateE('edge-trips-payments', 'trips', 'payments');
};
window.addEventListener('mouseup', () => {
    panState.active = false;
    document.getElementById('fullscreen-svg').style.cursor = 'default';
    if (dragState.node) dragState.node.style.cursor = 'grab';
    dragState.active = false;
    dragState.node = null;
});

// Run once to format edges correctly on load before the user triggers a mousemove event
setTimeout(() => { if (window.globalRoutingUpdate) window.globalRoutingUpdate() }, 100);
