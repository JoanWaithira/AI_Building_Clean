import { useState, useCallback, useMemo } from "react";
import { FONT } from "./roleHelpers.js";
import { Btn, SL, EmptyState } from "./panelUI.jsx";

const LS_KEY = "dtwin_maintenance_tasks";
const STATUS_META = {
  open: { label:"Open", color:"#FBBF24", bg:"rgba(251,191,36,0.12)" },
  in_progress: { label:"In Progress", color:"#60A5FA", bg:"rgba(96,165,250,0.12)" },
  resolved: { label:"Resolved", color:"#4ADE80", bg:"rgba(74,222,128,0.12)" },
};

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}
function dateFmt(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  return `${d.getDate()}/${d.getMonth() + 1}/${d.getFullYear()}`;
}

function TaskCard({ task, onStatusChange, onDelete }) {
  const [expanded, setExpanded] = useState(false);
  const sm = STATUS_META[task.status] || STATUS_META.open;
  const isOverdue = task.dueDate && task.status !== "resolved" && new Date(task.dueDate) < new Date();

  const NEXT_STATUS = { open: "in_progress", in_progress: "resolved", resolved: "open" };
  const NEXT_LABEL  = { open: "Start work",  in_progress: "Mark resolved", resolved: "Re-open" };

  return (
    <div style={{
      marginBottom: 7,
      background:   "rgba(15,23,42,0.7)",
      border:       `1px solid ${sm.color}33`,
      borderLeft:   `3px solid ${sm.color}`,
      borderRadius: 7,
      overflow:     "hidden",
      fontFamily:   FONT,
    }}>
      {/* Header row */}
      <button onClick={() => setExpanded(e => !e)}
        style={{ width:"100%", background:"transparent", border:"none", cursor:"pointer", padding:"7px 9px", display:"flex", alignItems:"center", gap:7, textAlign:"left" }}>
        <div style={{ flex:1, minWidth:0 }}>
          <div style={{ fontSize:11, fontWeight:700, color:"#E2E8F0", whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>
            {task.title}
          </div>
          <div style={{ display:"flex", gap:6, marginTop:2, alignItems:"center", flexWrap:"wrap" }}>
            <span style={{ fontSize:9, fontWeight:700, color:sm.color, background:sm.bg, padding:"1px 5px", borderRadius:4 }}>
              {sm.label}
            </span>
            {task.dueDate && (
              <span style={{ fontSize:8, color: isOverdue ? "#EF4444" : "#64748B" }}>
                {isOverdue ? "⚠ Overdue · " : "Due "}{dateFmt(task.dueDate)}
              </span>
            )}
            {task.faultLabel && (
              <span style={{ fontSize:8, color:"#94A3B8" }}>🔍 {task.faultLabel}</span>
            )}
          </div>
        </div>
        <span style={{ color:"#334155", fontSize:10, flexShrink:0 }}>{expanded ? "▲" : "▼"}</span>
      </button>

      {expanded && (
        <div style={{ padding:"0 9px 9px", borderTop:"1px solid rgba(255,255,255,0.04)" }}>
          {task.notes && (
            <p style={{ fontSize:10, color:"#94A3B8", margin:"7px 0 8px", lineHeight:1.5 }}>{task.notes}</p>
          )}
          <div style={{ fontSize:8, color:"#334155", marginBottom:8 }}>
            Created {dateFmt(task.createdAt)}
            {task.resolvedAt && ` · Resolved ${dateFmt(task.resolvedAt)}`}
          </div>
          <div style={{ display:"flex", gap:5, flexWrap:"wrap" }}>
            <button onClick={() => onStatusChange(task.id, NEXT_STATUS[task.status])}
              style={{ fontSize:9, fontWeight:700, padding:"3px 8px", borderRadius:4, cursor:"pointer", border:`1px solid ${sm.color}66`, background:sm.bg, color:sm.color, fontFamily:FONT }}>
              {NEXT_LABEL[task.status]}
            </button>
            <button onClick={() => onDelete(task.id)}
              style={{ fontSize:9, padding:"3px 8px", borderRadius:4, cursor:"pointer", border:"1px solid rgba(239,68,68,0.3)", background:"rgba(239,68,68,0.08)", color:"#FCA5A5", fontFamily:FONT }}>
              Delete
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function AddTaskForm({ onAdd, onCancel }) {
  const [title,      setTitle]      = useState("");
  const [dueDate,    setDueDate]    = useState("");
  const [notes,      setNotes]      = useState("");
  const [faultLabel, setFaultLabel] = useState("");

  const submit = () => {
    if (!title.trim()) return;
    onAdd({ id: uid(), title: title.trim(), dueDate, notes: notes.trim(), faultLabel: faultLabel.trim(), status:"open", createdAt: new Date().toISOString() });
  };

  const inputStyle = { width:"100%", boxSizing:"border-box", padding:"6px 8px", borderRadius:6, border:"1px solid rgba(125,211,252,0.2)", background:"rgba(15,23,42,0.9)", color:"#E2F1FF", fontSize:11, fontFamily:FONT, outline:"none", marginBottom:6 };

  return (
    <div style={{ background:"rgba(15,23,42,0.85)", border:"1px solid rgba(125,211,252,0.2)", borderRadius:8, padding:"10px 12px", marginBottom:10 }}>
      <div style={{ fontSize:10, fontWeight:700, color:"#7DD3FC", marginBottom:8, textTransform:"uppercase", letterSpacing:"0.06em" }}>New Work Order</div>
      <div style={{ fontSize:9, color:"#9AB8D7", marginBottom:3 }}>Title *</div>
      <input value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. Replace HVAC filter floor 2"
        onKeyDown={e => e.key === "Enter" && submit()} style={inputStyle} />
      <div style={{ fontSize:9, color:"#9AB8D7", marginBottom:3 }}>Linked fault (optional)</div>
      <input value={faultLabel} onChange={e => setFaultLabel(e.target.value)} placeholder="e.g. HVAC overconsumption" style={inputStyle} />
      <div style={{ fontSize:9, color:"#9AB8D7", marginBottom:3 }}>Due date</div>
      <input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)}
        style={{ ...inputStyle, colorScheme:"dark" }} />
      <div style={{ fontSize:9, color:"#9AB8D7", marginBottom:3 }}>Notes</div>
      <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} placeholder="Additional details…"
        style={{ ...inputStyle, resize:"vertical" }} />
      <div style={{ display:"flex", gap:6, marginTop:4 }}>
        <button onClick={submit} style={{ flex:1, padding:"6px 0", borderRadius:6, border:"none", background:"#2563EB", color:"#fff", cursor:"pointer", fontSize:11, fontWeight:700, fontFamily:FONT }}>
          Add task
        </button>
        <button onClick={onCancel} style={{ padding:"6px 10px", borderRadius:6, border:"1px solid rgba(255,255,255,0.1)", background:"transparent", color:"#64748B", cursor:"pointer", fontSize:11, fontFamily:FONT }}>
          Cancel
        </button>
      </div>
    </div>
  );
}

export default function MaintenanceCalendar({ onBack }) {
  const [tasks, setTasks] = useState(() => {
    try { return JSON.parse(localStorage.getItem(LS_KEY) || "[]"); } catch { return []; }
  });
  const [filter,  setFilter]  = useState("all");
  const [adding,  setAdding]  = useState(false);

  const persist = useCallback((next) => {
    setTasks(next);
    localStorage.setItem(LS_KEY, JSON.stringify(next));
  }, []);

  const addTask = useCallback((task) => {
    persist([...tasks, task]);
    setAdding(false);
  }, [tasks, persist]);

  const changeStatus = useCallback((id, status) => {
    persist(tasks.map(t => t.id === id
      ? { ...t, status, resolvedAt: status === "resolved" ? new Date().toISOString() : t.resolvedAt }
      : t
    ));
  }, [tasks, persist]);

  const deleteTask = useCallback((id) => {
    persist(tasks.filter(t => t.id !== id));
  }, [tasks, persist]);

  const visible = useMemo(() => {
    if (filter === "all")         return tasks;
    if (filter === "open")        return tasks.filter(t => t.status === "open");
    if (filter === "in_progress") return tasks.filter(t => t.status === "in_progress");
    if (filter === "resolved")    return tasks.filter(t => t.status === "resolved");
    if (filter === "overdue")     return tasks.filter(t => t.status !== "resolved" && t.dueDate && new Date(t.dueDate) < new Date());
    return tasks;
  }, [tasks, filter]);

  const counts = useMemo(() => ({
    open:        tasks.filter(t => t.status === "open").length,
    in_progress: tasks.filter(t => t.status === "in_progress").length,
    resolved:    tasks.filter(t => t.status === "resolved").length,
    overdue:     tasks.filter(t => t.status !== "resolved" && t.dueDate && new Date(t.dueDate) < new Date()).length,
  }), [tasks]);

  const FILTERS = [
    { key:"all",         label:"All",         badge: tasks.length       },
    { key:"open",        label:"Open",        badge: counts.open        },
    { key:"in_progress", label:"In Progress", badge: counts.in_progress },
    { key:"resolved",    label:"Resolved",    badge: counts.resolved    },
    { key:"overdue",     label:"Overdue",     badge: counts.overdue, danger: true },
  ];

  return (
    <>
      {/* Nav header */}
      <div style={{ display:"flex", alignItems:"center", gap:6, marginBottom:8 }}>
        <button onClick={onBack} style={{ background:"none", border:"none", cursor:"pointer", color:"#64748B", fontSize:14, fontFamily:FONT, padding:"2px 4px" }}>←</button>
        <span style={{ fontSize:13, fontWeight:700, color:"#34D399", fontFamily:FONT, flex:1 }}>🛠 Work Orders</span>
        <button onClick={() => setAdding(a => !a)}
          style={{ fontSize:10, fontWeight:700, padding:"4px 10px", borderRadius:6, border:"1px solid rgba(37,99,235,0.5)", background:"rgba(37,99,235,0.2)", color:"#93C5FD", cursor:"pointer", fontFamily:FONT }}>
          {adding ? "✕ Cancel" : "+ New"}
        </button>
      </div>

      {/* Summary chips */}
      <div style={{ display:"flex", gap:4, marginBottom:8, flexWrap:"wrap" }}>
        {[
          { label:"Open",     count:counts.open,        color:"#FBBF24" },
          { label:"Active",   count:counts.in_progress, color:"#60A5FA" },
          { label:"Done",     count:counts.resolved,    color:"#4ADE80" },
          { label:"Overdue",  count:counts.overdue,     color:"#EF4444" },
        ].map(({ label, count, color }) => (
          <div key={label} style={{ flex:1, textAlign:"center", background:`${color}12`, border:`1px solid ${color}33`, borderRadius:6, padding:"4px 2px" }}>
            <div style={{ fontSize:14, fontWeight:700, color: count > 0 ? color : "#334155" }}>{count}</div>
            <div style={{ fontSize:8, color:"#475569" }}>{label}</div>
          </div>
        ))}
      </div>

      {/* Add form */}
      {adding && <AddTaskForm onAdd={addTask} onCancel={() => setAdding(false)} />}

      {/* Filter tabs */}
      <div style={{ display:"flex", gap:3, marginBottom:8, flexWrap:"wrap" }}>
        {FILTERS.map(f => (
          <button key={f.key} onClick={() => setFilter(f.key)} style={{
            flex:1, minWidth:0, padding:"4px 2px", borderRadius:5, border:"1px solid rgba(125,211,252,0.12)",
            background: filter === f.key ? "rgba(125,211,252,0.12)" : "transparent",
            color:      filter === f.key ? "#7DD3FC" : "#475569",
            fontSize: 9, fontWeight: 700, cursor: "pointer", fontFamily: FONT,
            borderColor: f.danger && f.badge > 0 ? "rgba(239,68,68,0.3)" : undefined,
          }}>
            {f.label}
            {f.badge > 0 && (
              <span style={{ marginLeft:3, background: f.danger ? "#EF4444" : "rgba(125,211,252,0.25)", color: f.danger ? "#fff" : "#7DD3FC", borderRadius:8, padding:"0 4px", fontSize:8 }}>
                {f.badge}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Task list */}
      {visible.length === 0 ? (
        <EmptyState msg={tasks.length === 0 ? 'No work orders yet. Click "+ New" to add one.' : "No tasks match this filter."} />
      ) : (
        visible.map(task => (
          <TaskCard
            key={task.id}
            task={task}
            onStatusChange={changeStatus}
            onDelete={deleteTask}
          />
        ))
      )}
    </>
  );
}
