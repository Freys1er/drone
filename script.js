// ==========================================
// 1. INITIALIZE MAP
// ==========================================
const map = L.map('map-container', {
    zoomControl: false, attributionControl: false,
    scrollWheelZoom: false, dragging: true, doubleClickZoom: true
}).setView([23.6, 120.9], 8);

// ==========================================
// 2. LOAD ZONES DATA
// ==========================================
let globalZones = [];
async function loadZones() {
    try {
        // Attempts to load zones.json from same directory
        const res = await fetch('zones.json');
        if (!res.ok) throw new Error("JSON not found");
        const json = await res.json();
        
        // Convert ESRI to GeoJSON
        const geoJsonData = {
            type: "FeatureCollection",
            features: json.features.map(f => ({
                type: "Feature",
                properties: f.attributes,
                geometry: { type: "Polygon", coordinates: f.geometry.rings }
            }))
        };
        globalZones = geoJsonData.features;

        L.geoJSON(geoJsonData, {
            style: f => {
                const t = (f.properties['空域顏色'] || '') + (f.properties['空域名稱'] || '');
                const color = (t.includes('紅') || t.includes('機場')) ? '#ff453a' : '#ffd60a';
                return { color: color, weight: 1, opacity: 0.6, fillColor: color, fillOpacity: 0.15 };
            },
            onEachFeature: (f, l) => {
                l.bindPopup(`<div style="color:black; min-width:200px;">
                    <strong>${f.properties['空域名稱'] || 'Restricted Zone'}</strong><br>
                    <small>${f.properties['空域說明'] || ''}</small>
                </div>`);
            }
        }).addTo(map);

    } catch (e) { 
        console.log("Map Data Mode: Offline/Demo");
        // Add dummy zones if file missing so map isn't empty
        L.circle([25.0330, 121.5654], { radius: 1000, color: '#ff453a' }).addTo(map); // Taipei 101 Restricted
    }
}
loadZones();

// ==========================================
// 3. SCROLL OBSERVER (Transitions)
// ==========================================
const bgMap = document.getElementById('bg-map');
const bgVideo = document.getElementById('bg-video-container');
const bgVoid = document.getElementById('bg-void');
const zoomControls = document.getElementById('map-zoom-controls');

const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
        if (entry.isIntersecting) {
            const type = entry.target.getAttribute('data-bg');
            
            // Reset
            bgMap.style.opacity = 0;
            bgVideo.style.opacity = 0;
            bgVoid.style.opacity = 0;
            zoomControls.classList.remove('visible');

            // Activate
            if (type === 'map') {
                bgMap.style.opacity = 1;
                zoomControls.classList.add('visible');
                if(map) {
                    map.dragging.enable();
                    document.getElementById('main-content').style.pointerEvents = 'none'; // Pass clicks through empty areas
                }
            } else {
                // Video or Void
                if(type === 'video') bgVideo.style.opacity = 1;
                if(type === 'void') bgVoid.style.opacity = 1;
                
                if(map) map.dragging.disable();
                document.getElementById('main-content').style.pointerEvents = 'auto'; // Block map clicks
            }
        }
    });
}, { threshold: 0.5 });

document.querySelectorAll('section').forEach(section => observer.observe(section));

// ==========================================
// 4. VIDEO SCANNER
// ==========================================
async function scanVideos() {
    const container = document.getElementById('auto-gallery');
    container.innerHTML = '';
    let index = 1; 
    let found = 0;
    // Limit to check first 10 files
    while (index <= 10) {
        const path = `videos/${index}.mp4`;
        const vid = document.createElement('video');
        vid.src = path;
        const exists = await new Promise(r => {
            vid.onloadedmetadata = () => r(true);
            vid.onerror = () => r(false);
        });

        if (exists) {
            const card = document.createElement('div');
            card.className = 'vid-card';
            card.innerHTML = `
                <video class="vid-preview" src="${path}#t=1.0" muted onmouseover="this.play()" onmouseout="this.pause()" style="width:100%; height:100%; object-fit:cover; opacity:0.7;"></video>
                <div class="play-overlay"><i class="fa-solid fa-play"></i></div>
            `;
            card.onclick = () => {
                document.getElementById('video-modal').classList.add('active');
                const p = document.getElementById('main-player');
                p.src = path; p.play();
            };
            container.appendChild(card);
            found++;
        }
        index++;
    }
    if (found === 0) container.innerHTML = '<div style="padding:20px; color:#666;">No mission logs declassified.</div>';
}
scanVideos();

function closeVideo() {
    document.getElementById('video-modal').classList.remove('active');
    document.getElementById('main-player').pause();
}

// ==========================================
// 5. AIRSPACE ANALYZER
// ==========================================
async function analyzeAirspace() {
    const query = document.getElementById('target-loc').value;
    const resultBox = document.getElementById('analysis-result');
    const title = document.getElementById('result-title');
    const desc = document.getElementById('result-desc');

    if (!query) return;

    resultBox.style.display = 'block';
    title.innerText = "SATELLITE SCANNING...";
    title.style.color = "white";
    desc.innerText = "Triangulating coordinates...";

    try {
        // Nominatim Search
        const resp = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}`);
        const data = await resp.json();

        if (!data || data.length === 0) {
            title.innerText = "TARGET NOT FOUND";
            title.style.color = "#999";
            desc.innerText = "Please try a more specific address.";
            return;
        }

        const lat = parseFloat(data[0].lat);
        const lon = parseFloat(data[0].lon);
        
        // Fly Map
        map.flyTo([lat, lon], 14, { duration: 2 });
        L.marker([lat, lon]).addTo(map).bindPopup(query).openPopup();

        // Check Zones (Ray Casting)
        let violation = null;
        for (let feature of globalZones) {
            if (isPointInPoly(lon, lat, feature.geometry.coordinates[0])) {
                violation = feature.properties;
                break;
            }
        }

        if (violation) {
            title.innerText = "⚠️ RESTRICTED AIRSPACE";
            title.style.color = "#ff453a"; 
            desc.innerHTML = `Zone: <b>${violation['空域名稱'] || 'Unknown'}</b><br>Type: ${violation['空域顏色'] || 'Restricted'}`;
        } else {
            title.innerText = "✅ AIRSPACE CLEAR";
            title.style.color = "#30d158";
            desc.innerText = "No geofenced restrictions detected at this altitude.";
        }

    } catch (e) {
        title.innerText = "NETWORK ERROR";
        desc.innerText = "Uplink failed.";
    }
}

function isPointInPoly(x, y, poly) {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const xi = poly[i][0], yi = poly[i][1];
        const xj = poly[j][0], yj = poly[j][1];
        const intersect = ((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
        if (intersect) inside = !inside;
    }
    return inside;
}

// ==========================================
// 6. LOCATE USER
// ==========================================
function locateUser() {
    if(!map) return;
    map.locate({ setView: true, maxZoom: 14 })
       .on('locationerror', (e) => alert(e.message))
       .on('locationfound', (e) => {
           L.circle(e.latlng, { radius: e.accuracy / 2, color: '#2997ff' }).addTo(map);
       });
}