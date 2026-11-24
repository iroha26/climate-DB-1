// ===== 地図（地名を日本語で表示） =====
// OpenFreeMap のベクタータイルを使い、ラベルを name:ja（日本語名）優先に書き換える。
// 日本語名が登録されていない地物は現地名で表示される。
const JA_LABEL = [
    "coalesce",
    ["get", "name:ja"],
    ["get", "name_ja"],
    ["get", "name"]
];

const map = new maplibregl.Map({
    container: "map",
    style: "https://tiles.openfreemap.org/styles/liberty",
    center: [0, 20],
    zoom: 1,
    minZoom: 0.5,
    renderWorldCopies: false,
    attributionControl: { compact: false }
});

map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-left");

function applyJapaneseLabels() {
    map.getStyle().layers.forEach(layer => {
        if (
            layer.type === "symbol" &&
            layer.layout &&
            layer.layout["text-field"]
        ) {
            map.setLayoutProperty(layer.id, "text-field", JA_LABEL);
        }
    });
}


// ===== 気温データ =====
const cities = [];
let popup = null;

function escapeHtml(s) {
    return String(s ?? "").replace(/[&<>"']/g, ch => ({
        "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    })[ch]);
}

function popupHtml(c) {
    return `
        <b>${escapeHtml(c.city)}</b>（${escapeHtml(c.cityEn)}）<br>
        国: ${escapeHtml(c.country)}<br>
        最高気温: ${escapeHtml(c.maxTemp || "－")}℃<br>
        最低気温: ${escapeHtml(c.minTemp || "－")}℃<br>
        状況: ${escapeHtml(c.status)}
    `;
}

function openPopup(c) {
    if (popup) popup.remove();
    popup = new maplibregl.Popup({ offset: 8 })
        .setLngLat([c.lng, c.lat])
        .setHTML(popupHtml(c))
        .addTo(map);
}

function loadData() {
    return new Promise(resolve => {
        Papa.parse("data/temperature.csv", {
            download: true,
            header: true,
            skipEmptyLines: true,
            complete: results => resolve(results.data)
        });
    });
}

// スタイル読み込み直後に書き換え、英語ラベルが一瞬表示されるのを防ぐ
map.on("style.load", applyJapaneseLabels);

map.on("load", async () => {

    const rows = await loadData();

    let completed = 0;

    rows.forEach(row => {
        if (!row.latitude || !row.longitude) return;

        const c = {
            id: cities.length,
            city: row.city,
            country: row.country,
            cityEn: row.city_en,
            countryEn: row.country_en,
            maxTemp: row.max_temp,
            minTemp: row.min_temp,
            status: row["取得状況"],
            lat: parseFloat(row.latitude),
            lng: parseFloat(row.longitude)
        };
        c.searchText = normalize(
            [c.city, c.country, c.cityEn, c.countryEn,
             KANA[c.city], KANA[c.country]].join(" ")
        );

        if (c.status === "取得済") completed++;
        cities.push(c);
    });

    const total = cities.length;
    const rate = total ? ((completed / total) * 100).toFixed(1) : "0.0";

    document.getElementById("stats").innerHTML = `
総地点数: ${total}<br>
取得済: ${completed}<br>
未取得: ${total - completed}<br>
取得率: ${rate}%
`;

    map.addSource("cities", {
        type: "geojson",
        data: {
            type: "FeatureCollection",
            features: cities.map(c => ({
                type: "Feature",
                geometry: { type: "Point", coordinates: [c.lng, c.lat] },
                properties: { id: c.id, status: c.status }
            }))
        }
    });

    map.addLayer({
        id: "cities",
        type: "circle",
        source: "cities",
        paint: {
            "circle-radius": 6,
            "circle-color": [
                "case",
                ["==", ["get", "status"], "取得済"], "green",
                "red"
            ],
            "circle-opacity": 0.8,
            "circle-stroke-width": 2,
            "circle-stroke-color": [
                "case",
                ["==", ["get", "status"], "取得済"], "green",
                "red"
            ]
        }
    });

    map.on("click", "cities", e => {
        const id = e.features[0].properties.id;
        openPopup(cities[id]);
    });

    map.on("mouseenter", "cities", () => {
        map.getCanvas().style.cursor = "pointer";
    });

    map.on("mouseleave", "cities", () => {
        map.getCanvas().style.cursor = "";
    });
});


// ===== 検索 =====
// 漢字表記の地名は、ひらがな・カタカナでも検索できるよう読みを持たせる
const KANA = {
    "北京": "ペキン", "高昌区": "コウショウク", "上海": "シャンハイ", "広州": "コウシュウ",
    "重慶": "ジュウケイ", "札幌": "サッポロ", "旭川": "アサヒカワ", "東京": "トウキョウ",
    "熊谷": "クマガヤ", "長野": "ナガノ", "釜山": "プサン", "香港": "ホンコン", "台北": "タイペイ",
    "中国": "チュウゴク", "日本": "ニホン ニッポン", "韓国": "カンコク", "台湾": "タイワン",
    "南アフリカ": "ミナミアフリカ", "クウェート市": "クウェートシ", "ジブチ市": "ジブチシ",
    "サンタクルス県": "サンタクルスケン", "カノ州": "カノシュウ", "ハリュ県": "ハリュケン"
};

// ひらがな→カタカナ、全角英数→半角、大文字→小文字にそろえて比較する
function normalize(text) {
    return (text || "")
        .replace(/[ぁ-ゖ]/g, ch =>
            String.fromCharCode(ch.charCodeAt(0) + 0x60))
        .replace(/[Ａ-Ｚａ-ｚ０-９]/g, ch =>
            String.fromCharCode(ch.charCodeAt(0) - 0xFEE0))
        .toLowerCase()
        .trim();
}

function findCities(keyword) {
    const key = normalize(keyword);
    if (!key) return [];
    return cities.filter(c => c.searchText.includes(key));
}

// Leaflet のズーム値に合わせるため 1 引く（MapLibre は 512px タイル基準）
function showCity(c, leafletZoom) {
    map.flyTo({ center: [c.lng, c.lat], zoom: leafletZoom - 1 });
    map.once("moveend", () => openPopup(c));
}

const searchInput = document.getElementById("citySearch");
const suggestions = document.getElementById("suggestions");

function searchCity() {
    const c = findCities(searchInput.value)[0];

    if (c) {
        suggestions.innerHTML = "";
        showCity(c, 8);
    } else {
        alert("都市が見つかりません");
    }
}

searchInput.addEventListener("keypress", function (e) {
    if (e.key === "Enter") {
        searchCity();
    }
});

searchInput.addEventListener("input", function () {

    suggestions.innerHTML = "";

    findCities(this.value).slice(0, 10).forEach(c => {

        const div = document.createElement("div");
        div.className = "suggestion-item";
        div.textContent = `${c.city}（${c.country}）`;

        div.addEventListener("click", () => {
            searchInput.value = c.city;
            suggestions.innerHTML = "";
            showCity(c, 10);
        });

        suggestions.appendChild(div);
    });
});
