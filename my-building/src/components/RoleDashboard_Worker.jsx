import { useState, useEffect, useMemo } from "react";
import { comfortStatus, dispatchCmd, FONT } from "./roleHelpers.js";
import { Btn, SL, Hr, Pill, Sparkline, EmptyState } from "./panelUI.jsx";
import {
  ROOM_BMS_ENDPOINTS, MOCK_ROOM_DATA,
  fetchLatestRoomTelemetry, fetchRoomHistory,
} from "../utils/roomDataUtils.js";

/** Normalise room number to the X.XX key used by ROOM_BMS_ENDPOINTS */
function toReplayRoomKey(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  const asDotted = raw.match(/^(-?\d+)\.(\d+)$/);
  if (asDotted) return `${parseInt(asDotted[1], 10)}.${asDotted[2].padStart(2, "0")}`;
  const compact3 = raw.match(/^(-?\d)(\d{2})$/);
  if (compact3) return `${compact3[1]}.${compact3[2]}`;
  return raw;
}

function formatTime(ms) {
  if (!Number.isFinite(ms)) return "--:--";
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`;
}

/** Convert raw BMS history {temp,humidity,co2} → IAQ replay-style frames.
 */
function buildFrames(history, days = 2) {
  // Adapt bucket size: 2d→15min, 7d→1h, 30d→4h
  const bucketMs = days <= 2 ? 15*60*1000 : days <= 7 ? 60*60*1000 : 4*60*60*1000;
  const snap = (ms) => Math.floor(ms / bucketMs) * bucketMs;
  const metricMap = { temp: "temperature", humidity: "humidity", co2: "co2" };
  const buckets = new Map();
  Object.entries(metricMap).forEach(([hk, mk]) => {
    const pts = Array.isArray(history?.[hk]) ? history[hk] : [];
    pts.forEach((p) => {
      const ts = Number(p?.t), v = Number(p?.v);
      if (!Number.isFinite(ts) || !Number.isFinite(v)) return;
      const b = snap(ts);
      const e = buckets.get(b) || { timestampMs: b };
      e[mk] = v;
      buckets.set(b, e);
    });
  });
  const sorted = [...buckets.values()].sort((a, b) => a.timestampMs - b.timestampMs);
  let lastT = null, lastH = null, lastC = null;
  return sorted.map((s) => {
    if (Number.isFinite(s.temperature)) lastT = s.temperature;
    if (Number.isFinite(s.humidity)) lastH = s.humidity;
    if (Number.isFinite(s.co2)) lastC = s.co2;
    return { timestampMs: s.timestampMs, time: formatTime(s.timestampMs), temperature: lastT, humidity: lastH, co2: lastC };
  }).filter((s) => s.temperature != null || s.humidity != null || s.co2 != null);
}

function fmtClimate(metric, value) {
  if (metric === "temperature") return `${value.toFixed(1)} °C`;
  if (metric === "humidity") return `${Math.round(value)} %`;
  if (metric === "co2") return `${Math.round(value)} ppm`;
  return `${value}`;
}

function formatFloorLabel(room) {
  const geoLabel = String(room?.floorLabel || "").trim();
  if (geoLabel) return geoLabel;
  const floorLevel = Number(room?.floorLevel);
  return Number.isFinite(floorLevel) ? `FL ${floorLevel}` : "Unknown floor";
}

export default function WorkerView({ availableRooms, availableFloors }) {
  const [floor,       setFloor]       = useState(null);
  const [roomNum,     setRoomNum]     = useState(null);
  const [metric,      setMetric]      = useState("temperature");
  const [reportOpen,  setReportOpen]  = useState(false);
  const [reportType,  setReportType]  = useState(null);

  // BMS trend state
  const [trendMetric, setTrendMetric] = useState("temperature");
  const [histDays,    setHistDays]    = useState(2);
  const [frames,      setFrames]      = useState([]);
  const [loading,     setLoading]     = useState(false);

  const workerFloorOptions = useMemo(() => {
    const byGeoFloor = new Map();
    availableRooms.forEach((room) => {
      const floorLevel = Number(room.floorLevel);
      if (!Number.isFinite(floorLevel)) return;
      if (!byGeoFloor.has(floorLevel)) {
        byGeoFloor.set(floorLevel, {
          floorLevel,
          label: formatFloorLabel(room),
        });
      }
    });

    const mapped = Array.from(byGeoFloor.values()).sort((a, b) => a.floorLevel - b.floorLevel);

    if (mapped.length) return mapped;

    return (availableFloors || [])
      .map((f) => Number(f))
      .filter((f) => Number.isFinite(f))
      .sort((a, b) => a - b)
      .map((f) => ({ floorLevel: f, label: `FL ${f}` }));
  }, [availableRooms, availableFloors]);

  const floorRooms = useMemo(
    () => availableRooms
      .filter((room) => Number(room.floorLevel) === floor)
      .sort((a, b) => String(a.roomNumber).localeCompare(String(b.roomNumber), undefined, { numeric: true, sensitivity: "base" })),
    [availableRooms, floor]
  );
  const roomKey    = roomNum ? String(roomNum) : null;
  const bmsKey     = useMemo(() => toReplayRoomKey(roomNum), [roomNum]);
  const roomMeta   = availableRooms.find(r => String(r.roomNumber) === roomKey);
  const mockMeta   = MOCK_ROOM_DATA[bmsKey] || MOCK_ROOM_DATA[roomKey];

  // Always use locally-fetched frames (from DB, like IAQ replay)
  const chartFrames  = frames.length >= 2 ? frames : null;
  const latestSample = chartFrames ? chartFrames[chartFrames.length - 1] : null;
  const status       = latestSample ? comfortStatus(latestSample.temperature, latestSample.co2, latestSample.humidity) : null;

  // Fetch room history from DB (same approach as IAQ replay):
  // 1. Get latest telemetry to find the DB's last timestamp
  // 2. Use that as endIso → fetchRoomHistory works backwards from there
  useEffect(() => {
    if (!bmsKey) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const latest = await fetchLatestRoomTelemetry(bmsKey).catch(() => ({ timestampMs: null }));
        const endIso = Number.isFinite(latest?.timestampMs)
          ? new Date(latest.timestampMs).toISOString()
          : null;
        const histData = await fetchRoomHistory(bmsKey, histDays, endIso);
        if (!cancelled) {
          const built = buildFrames(histData, histDays);
          setFrames(built);
        }
      } catch (e) { console.warn("Worker room fetch:", e); }
      if (!cancelled) setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [bmsKey, histDays]);

  const formatVal = (m, v) => {
    if (!Number.isFinite(v)) return "—";
    if (m === "temperature") return `${v.toFixed(1)}°C`;
    if (m === "humidity")    return `${Math.round(v)}%`;
    if (m === "co2")         return `${Math.round(v)} ppm`;
    return `${v}`;
  };

  const metricGood = (m, v) => {
    if (!Number.isFinite(v)) return "—";
    if (m === "temperature") return v >= 18 && v <= 25 ? "✓ Good" : v > 25 ? "⚠ Warm":"⚠ Cold";
    if (m === "humidity")    return v >= 30 && v <= 65 ? "✓ Good" : "⚠ Check";
    if (m === "co2")         return v < 800 ? "✓ Good" : v < 1000 ? "⚠ Fair" : "⚠ Stale";
    return "—";
  };

  const sendReport = () => {
    if (!roomMeta || !reportType) return;
    const floorText = formatFloorLabel(roomMeta);
    const subject = encodeURIComponent(`Comfort issue — Room ${roomMeta.roomNumber}, ${floorText}`);
    const body = encodeURIComponent(
      `I am reporting a ${reportType} issue in Room ${roomMeta.roomNumber} on ${floorText}.\n\n` +
      `Current readings:\nTemperature: ${formatVal("temperature", latestSample?.temperature)}\n` +
      `Air quality: ${formatVal("co2", latestSample?.co2)}\nHumidity: ${formatVal("humidity", latestSample?.humidity)}\n\n` +
      `Time: ${new Date().toLocaleString()}`
    );
    window.open(`mailto:facilities@example.com?subject=${subject}&body=${body}`);
    setReportOpen(false);
  };

  return (
    <>
      <SL>Which floor do you work on?</SL>
      <div style={{ display:"flex", gap:6, flexWrap:"wrap", marginBottom:10 }}>
        {workerFloorOptions.map(({ floorLevel, label }) => (
          <Btn
            key={floorLevel}
            active={floor===floorLevel}
            onClick={() => {
              setFloor(floorLevel);
              setRoomNum(null);
              dispatchCmd("zoom_to_floor", { floor: floorLevel });
            }}
          >
            {label}
          </Btn>
        ))}
      </div>

      {floor !== null && (
        <>
          <SL>Which is your room?</SL>
          <div style={{ display:"flex", gap:5, flexWrap:"wrap", marginBottom:10 }}>
            {floorRooms.map(r => (
              <Btn key={r.roomNumber} small active={roomNum===r.roomNumber}
                onClick={() => { setRoomNum(r.roomNumber); dispatchCmd("zoom_to_room", { room_query: r.roomNumber }); }}>
                {r.roomNumber}
              </Btn>
            ))}
            {floorRooms.length === 0 && <EmptyState msg="No rooms on this floor"/>}
          </div>
        </>
      )}

      {roomNum && latestSample && (
        <>
          <div style={{ background:"rgba(15,23,42,0.9)", border:"1px solid rgba(125,211,252,0.2)", borderRadius:10, padding:"12px 14px", marginBottom:8 }}>
            <div style={{ fontWeight:700, fontSize:13, color:"#E2F1FF", marginBottom:8 }}>
              Room {roomNum} — {roomMeta?.roomName || ""}
            </div>
            {[
              { m:"temperature", icon:"🌡", label:"Temperature" },
              { m:"co2",         icon:"💨", label:"Air quality" },
              { m:"humidity",    icon:"💧", label:"Humidity" },
            ].map(({ m, icon, label }) => (
              <div key={m} style={{ display:"flex", alignItems:"center", gap:8, padding:"5px 0", borderBottom:"1px solid rgba(255,255,255,0.04)" }}>
                <span style={{ fontSize:14 }}>{icon}</span>
                <div style={{ flex:1, fontSize:11, color:"#CBD5E1" }}>{label}</div>
                <div style={{ fontSize:12, fontWeight:700, color:"#E2F1FF" }}>{formatVal(m, latestSample[m])}</div>
                <div style={{ fontSize:10, color: metricGood(m, latestSample[m]).includes("Good") ? "#4ADE80":"#FBBF24" }}>
                  {metricGood(m, latestSample[m])}
                </div>
              </div>
            ))}
            <div style={{ marginTop:10, padding:"8px 10px", background: status?.color+"22", border:`1px solid ${status?.color}44`, borderRadius:6, fontSize:11, color:status?.color, fontWeight:600 }}>
              {status?.label}
            </div>
          </div>
        </>
      )}

      {roomNum && (
        <>
          {mockMeta && (
            <>
              <Hr/>
              <SL>Room occupancy</SL>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, marginBottom: 10 }}>
                <Pill label="Current (avg)" value={mockMeta.avgOccupancy ?? "—"} color="#60A5FA" />
                <Pill label="Max capacity"  value={mockMeta.occupancy ?? "—"}    color="#F97316" />
              </div>
            </>
          )}

          <Hr/>
          

          <Hr/>
          <Btn full danger onClick={() => setReportOpen(p=>!p)}>📢 Report a comfort issue</Btn>

          {reportOpen && (
            <div style={{ background:"rgba(15,23,42,0.95)", border:"1px solid rgba(248,113,113,0.3)", borderRadius:8, padding:"10px 12px", marginTop:8 }}>
              <div style={{ fontSize:11, color:"#E2F1FF", marginBottom:8 }}>What's the problem?</div>
              <div style={{ display:"flex", gap:5, flexWrap:"wrap", marginBottom:8 }}>
                {["Too hot","Too cold","Stuffy","Noisy","Other"].map(t => (
                  <Btn key={t} small active={reportType===t} onClick={() => setReportType(t)}>{t}</Btn>
                ))}
              </div>
              <Btn full accent onClick={sendReport} style={{ opacity: reportType ? 1 : 0.4 }}>
                📧 Open email draft
              </Btn>
            </div>
          )}
        </>
      )}
    </>
  );
}
