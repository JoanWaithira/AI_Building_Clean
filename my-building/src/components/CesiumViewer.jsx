import React from "react";

function CesiumViewer(props) {
  // Core Cesium engine + scene + entity logic
  // Receives hooks and passes state to UI views
  return (
    <>
      {/* Cesium canvas and overlays */}
      <div ref={props.viewerRef} id="cesiumContainer" />
      {/* UI panels and views go here as children or via props */}
      {props.children}
    </>
  );
}

export default CesiumViewer;
