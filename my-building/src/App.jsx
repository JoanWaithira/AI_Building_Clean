import "./App.css";
import CesiumGeoJsonViewer from "./components/CEsiumGeoJsonViewer.jsx";
import FacilityChatbot from "./components/FacilityChatbot.jsx";

function App() {
  return (
    <div className="app-layout">
      <div className="viewer-area">
        <CesiumGeoJsonViewer />
      </div>
      <FacilityChatbot />
    </div>
  );
}

export default App;
