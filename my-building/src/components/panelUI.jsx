import { FONT, fmtW } from "./roleHelpers.js";

export const PS = {
  background:"rgba(15, 23, 36, 0.97)",
  border:"1px solid rgba(125,211,252,0.2)",borderRadius:12,
  boxShadow:"0 12px 40px rgba(2,6,23,0.6),inset 0 1px 0 rgba(255,255,255,0.05)",
  backdropFilter:"blur(20px)",color:"#D1E8FF",fontFamily:FONT,fontSize:12,
};

export const Btn = ({ children, onClick, style={}, active=false, accent=false, full=false, danger=false, small=false }) => (
  <button onClick={onClick} style={{
    borderRadius:6, border:"1px solid rgba(125,211,252,0.28)", cursor:"pointer",
    fontFamily:FONT, fontSize:small?10:12, fontWeight:600, letterSpacing:"0.01em",
    transition:"all 0.15s ease", padding:small?"5px 8px":"7px 10px",
    width:full?"100%":undefined,
    background:danger?"rgba(220,38,38,0.24)":active?"rgba(37,99,235,0.35)":accent?"rgba(14,165,233,0.24)":"rgba(255,255,255,0.08)",
    color:danger?"#FECACA":active?"#DBEAFE":accent?"#CFFAFE":"#DDEFFF",
    borderColor:danger?"rgba(248,113,113,0.58)":active?"rgba(147,197,253,0.72)":accent?"rgba(125,211,252,0.6)":"rgba(186,230,253,0.35)",
    ...style,
  }}>{children}</button>
);

export const SL = ({ children }) => (
  <div style={{ fontSize:10, fontWeight:700, letterSpacing:"0.06em", textTransform:"uppercase", color:"#A5C8EC", marginBottom:5, marginTop:12 }}>
    {children}
  </div>
);

export const Hr = () => <div style={{ height:1, background:"rgba(147,197,253,0.2)", margin:"10px 0" }} />;

export const Pill = ({ label, value, sub, color="#E2F1FF", wide=false }) => (
  <div style={{ background:"rgba(15,23,42,0.85)", border:"1px solid rgba(125,211,252,0.2)", borderRadius:8, padding:"8px 10px", gridColumn:wide?"1/-1":undefined }}>
    <div style={{ fontSize:9, color:"#9AB8D7", marginBottom:3, textTransform:"uppercase", letterSpacing:"0.05em" }}>{label}</div>
    <div style={{ fontSize:14, fontWeight:700, color }}>{value}</div>
    {sub && <div style={{ fontSize:9, color:"#64748B", marginTop:2 }}>{sub}</div>}
  </div>
);

export function EmptyState({ msg = "No data available" }) {
  return (
    <div style={{ padding:"14px 10px", textAlign:"center", fontSize:11, color:"#475569", border:"1px dashed rgba(125,211,252,0.12)", borderRadius:8, marginBottom:8 }}>
      {msg}
    </div>
  );
}

export function Sparkline({ frames, valueKey="watts", color="#60A5FA", h=54, filled=true }) {
  if (!frames || frames.length < 2) return <EmptyState msg="No chart data" />;
  const vals = frames.map(f => Number(f[valueKey] ?? 0));
  const minV = Math.min(...vals);
  const maxV = Math.max(...vals);
  const range = Math.max(0.001, maxV - minV);
  const W = 264;
  const pts = frames.map((f, i) => {
    const x = (i / (frames.length - 1)) * W;
    const y = h - ((Number(f[valueKey] ?? 0) - minV) / range) * (h - 4) - 2;
    return `${x},${y}`;
  }).join(" ");
  return (
    <svg width="100%" viewBox={`0 0 ${W} ${h+2}`} style={{ display:"block", borderRadius:4, background:"rgba(10,15,26,0.7)", border:"1px solid rgba(96,165,250,0.08)", marginBottom:6 }}>
      <defs>
        <linearGradient id={`sg-${color.replace("#","")}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.45"/>
          <stop offset="100%" stopColor={color} stopOpacity="0.02"/>
        </linearGradient>
      </defs>
      {filled && <polyline points={`0,${h} ${pts} ${W},${h}`} fill={`url(#sg-${color.replace("#","")})`} stroke="none"/>}
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round"/>
    </svg>
  );
}

export function BarChart({ items, maxVal }) {
  const W = 264, barH = 12, gap = 4;
  const h = items.length * (barH + gap);
  return (
    <svg width="100%" viewBox={`0 0 ${W} ${h}`} style={{ display:"block", borderRadius:4 }}>
      {items.map(({ label, value, color }, i) => {
        const pct = Math.min(1, value / Math.max(0.001, maxVal));
        const y = i * (barH + gap);
        return (
          <g key={label}>
            <rect x={0} y={y} width={W} height={barH} fill="rgba(255,255,255,0.03)" rx={2}/>
            <rect x={0} y={y} width={pct * W} height={barH} fill={color || "#60A5FA"} rx={2} opacity={0.85}/>
            <text x={4} y={y + barH - 3} fontSize={8} fill="#CBD5E1" fontFamily={FONT}>{label}</text>
            <text x={W - 2} y={y + barH - 3} fontSize={8} fill="#94A3B8" fontFamily={FONT} textAnchor="end">{fmtW(value)}</text>
          </g>
        );
      })}
    </svg>
  );
}

export function RoleEcosystemCard({ titleColor, border, background, intro, bullets }) {
  return (
    <div
      style={{
        marginBottom: 12,
        padding: "10px 12px",
        borderRadius: 8,
        border,
        background,
        fontFamily: FONT,
      }}
    >
      <div
        style={{
          fontSize: 10,
          fontWeight: 700,
          letterSpacing: "0.06em",
          textTransform: "uppercase",
          color: titleColor,
          marginBottom: 8,
        }}
      >
        Role in the building ecosystem
      </div>
      {intro}
      <ul style={{ margin: 0, padding: "0 0 0 16px", fontSize: 10, color: "#9AB8D7", lineHeight: 1.5 }}>
        {bullets.map((text, i) => (
          <li key={i} style={{ marginBottom: i < bullets.length - 1 ? 4 : 0 }}>{text}</li>
        ))}
      </ul>
    </div>
  );
}
