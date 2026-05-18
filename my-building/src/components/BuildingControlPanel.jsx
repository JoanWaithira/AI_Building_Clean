export default function BuildingControlPanel({ viewerRef }) {
  const floors = [0, 1, 2, 3, 4];

  return (
    <div
      style={{
        position: "absolute",
        left: 10,
        top: 10,
        zIndex: 1000,
        background: "#1e1e1e",
        padding: 10,
        borderRadius: 6,
        color: "white",
        width: 180,
      }}
    >
      <h4>Floors</h4>

      {floors.map((f) => (
        <button
          key={f}
          style={{ display: "block", marginBottom: 6 }}
          onClick={() => viewerRef.current.zoomToFloor(f)}
        >
          Floor {f}
        </button>
      ))}

      <hr />

      <h4>Rooms</h4>

      <button onClick={() => viewerRef.current.zoomToRoom("004")}>
        Room 004
      </button>

      <button onClick={() => viewerRef.current.zoomToRoom("2.14")}>
        Room 2.14
      </button>

      <button onClick={() => viewerRef.current.zoomToRoom("3.20")}>
        Room 3.20
      </button>

      <hr />

      <button onClick={() => viewerRef.current.resetSelection()}>
        Reset
      </button>
    </div>
  );
}