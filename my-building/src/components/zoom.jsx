import { useEffect, useRef, useState } from "react";
import * as Cesium from "cesium";

export default function CesiumGeoJsonViewer({ onFeatureClick }) {
  const containerRef = useRef(null);
  const viewerRef = useRef(null);
  const i3sProviderRef = useRef(null);
  const roomEntitiesRef = useRef([]);
  const homeDestinationRef = useRef(null);

  const [loading, setLoading] = useState(true);
  const [availableFloors, setAvailableFloors] = useState([]);
  const [availableRooms, setAvailableRooms] = useState([]);
  const [selectedRoom, setSelectedRoom] = useState("");

  const translateRoomName = (bulgarianName) => {
    if (!bulgarianName) return "";

    const translations = {
      "ЗОНА ЗА ИЗЧАКВАНЕ": "Waiting Zone",
      "КОРИДОР": "Corridor",
      "ИЗСЛЕДОВАТЕЛИ": "Researchers",
      "КАБИНЕТ": "Office",
      "WC ЖЕНИ": "Women's WC",
      "WC МЪЖЕ": "Men's WC",
      "WC за хора в  неравностойно  положение": "Accessible WC",
      "WC за хора в неравностойно положение": "Accessible WC",
      "СТЪЛБА": "Staircase",
      "ЕВАКУАЦИОННА СТЪЛБА": "Emergency Staircase",
      "АСАНСЬОР И ШАХТА": "Elevator Shaft",
      "АСАНСЬОР": "Elevator",
      "АСАНСЬОРНА ШАХТА": "Elevator Shaft",
      "ПОМЕЩЕНИЕ ЕЛ": "Electrical Room",
      "ПОМЕЩЕНИЕ UPS": "UPS Room",
      "ПОМЕЩЕНИЕ": "Room",
      "ТЕХНИЧЕСКА СТАЯ": "Technical Room",
      "ТЕХНОЛОГИЧНА СТАЯ": "Technical Room",
      "СЪРВЪРНО ПОМЕЩЕНИЕ": "Server Room",
      "АБОНАТНА СТАНЦИЯ": "Subscriber Station",
      "ГРТ": "Gas Regulation Station",
      "IT ОТДЕЛ": "IT Department",
      "ОФИС": "Office",
      "БИЗНЕС РАЗВИТИЕ": "Business Development",
      "ГАРДЕРОБ": "Wardrobe",
      "ЧОВЕШКИ РЕСУРСИ": "Human Resources",
      "СЧЕТОВОДИТЕЛ": "Accountant",
      "ДИРЕКТОР": "Director",
      "АСИСТЕНТ": "Assistant",
      "ЗАМ. ДИРЕКТОР": "Deputy Director",
      "ДЕЛОВОДИТЕЛ И ДОМАКИН": "Administrator",
      "РЪКОВОДИТЕЛ НА ИЗСЛЕДОВАТЕЛСКА ГРУПА": "Research Group Leader",
      "ЗАЛА ЗА СРЕЩИ": "Meeting Room",
      "ЗАЛА ЗА КОНФЕРЕНЦИИ": "Conference Hall",
      "ЗАЛА ЗА КОНФЕРЕНТНИ РАЗГОВОРИ": "Conference Room",
      "ЗАЛА ЗА СЕМИНАРНИ СРЕЩИ": "Seminar Room",
      "ЗАЛА ЗА ВИЗУАЛИЗАЦИЯ": "Visualization Hall",
      "ЗАЛА SAP": "SAP Hall",
      "ПРОСТРАНСТВО ЗА ХРАНЕНЕ": "Dining Area",
      "ОТВОРЕНО ПРОСТРАНСТВО ЗА РАБОТА": "Open Work Space",
      "ФОАЙЕ": "Foyer",
      "ФОАЙЕ / ЗОНА ЗА ДИСКУСИИ": "Foyer / Discussion Zone",
      "ВИНДФАНГ": "Vestibule",
      "СТАЯ ЗА ПОЧИВКА": "Break Room",
      "СТОЛОВА": "Cafeteria",
      "КУХНЯ": "Kitchen",
      "СКЛАДОВА БАЗА": "Storage Room",
      "СКЛАД": "Storage",
      "АРХИВ": "Archive",
      "КОПИРНА": "Copy Room",
      "КАСИЕР": "Cashier",
      "РЕЦЕПЦИЯ": "Reception",
      "ЛАБОРАТОРИЯ ЗА ОБУЧЕНИЕ": "Training Laboratory",
      "ЗАЛ": "Hall",
      "ЗАЛА": "Hall",
      "САНИТАРЕН ВЪЗЕЛ": "Restroom",
      "БАНЯ": "Bathroom",
    };

    if (translations[bulgarianName]) return translations[bulgarianName];

    const upper = bulgarianName.toUpperCase();
    for (const [bg, en] of Object.entries(translations)) {
      if (upper.includes(bg.toUpperCase())) return en;
    }

    return bulgarianName;
  };

  const getRoomColor = (roomName) => {
    const name = (roomName || "").toUpperCase();

    if (name.includes("WC") || name.includes("TOILET")) {
      return Cesium.Color.fromCssColorString("#FFFFFF").withAlpha(0.88);
    }
    if (name.includes("STAIRCASE") || name.includes("СТЪЛБА")) {
      return Cesium.Color.fromCssColorString("#7A7A7A").withAlpha(0.92);
    }
    if (name.includes("ELEVATOR") || name.includes("АСАНСЬОР")) {
      return Cesium.Color.fromCssColorString("#5C5C5C").withAlpha(0.92);
    }
    if (name.includes("CORRIDOR") || name.includes("КОРИДОР")) {
      return Cesium.Color.fromCssColorString("#E8E8E8").withAlpha(0.78);
    }
    if (
      name.includes("MEETING") ||
      name.includes("CONFERENCE") ||
      name.includes("ЗАЛА")
    ) {
      return Cesium.Color.fromCssColorString("#D4A373").withAlpha(0.85);
    }
    if (name.includes("DIRECTOR") || name.includes("ДИРЕКТОР")) {
      return Cesium.Color.fromCssColorString("#8B4513").withAlpha(0.88);
    }
    if (
      name.includes("IT") ||
      name.includes("TECHNICAL") ||
      name.includes("ЕЛЕКТР")
    ) {
      return Cesium.Color.fromCssColorString("#B0B0B0").withAlpha(0.85);
    }

    return Cesium.Color.fromCssColorString("#4DA3FF").withAlpha(0.72);
  };

  const getRoomData = (roomType) => {
    const base = {
      temp: 22,
      humidity: 45,
      occupancy: 0,
      co2: 400,
    };

    if ((roomType || "").toUpperCase().includes("WC")) {
      return { ...base, temp: 20, humidity: 55 };
    }
    if ((roomType || "").toUpperCase().includes("MEETING")) {
      return { ...base, temp: 23, humidity: 42, occupancy: 8, co2: 600 };
    }

    return {
      ...base,
      temp: 22 + Math.floor(Math.random() * 3),
      humidity: 40 + Math.floor(Math.random() * 10),
      occupancy: Math.floor(Math.random() * 4),
      co2: 450 + Math.floor(Math.random() * 300),
    };
  };

  const geometryToPolygons = (geometry, baseElevation) => {
    if (!geometry) return [];

    const ringToPositions = (ring) =>
      ring.map(([lon, lat]) =>
        Cesium.Cartesian3.fromDegrees(lon, lat, baseElevation)
      );

    if (geometry.type === "Polygon") {
      const outerRing = geometry.coordinates?.[0];
      if (!Array.isArray(outerRing) || outerRing.length < 3) return [];
      return [ringToPositions(outerRing)];
    }

    if (geometry.type === "MultiPolygon") {
      return geometry.coordinates
        .map((polygon) => polygon?.[0])
        .filter((outerRing) => Array.isArray(outerRing) && outerRing.length >= 3)
        .map((outerRing) => ringToPositions(outerRing));
    }

    return [];
  };

  const resetStylesAndLabels = () => {
    roomEntitiesRef.current.forEach((entity) => {
      if (entity.polygon && entity.originalMaterial) {
        entity.polygon.material = entity.originalMaterial;
      }
      if (entity.labelEntity) {
        entity.labelEntity.show = false;
      }
    });
  };

  const getBoundingSphereFromEntities = (entities) => {
    const positions = [];

    entities.forEach((entity) => {
      const hierarchy = entity.polygon?.hierarchy?.getValue?.(Cesium.JulianDate.now());
      if (hierarchy?.positions) {
        positions.push(...hierarchy.positions);
      }
    });

    if (!positions.length) return null;
    return Cesium.BoundingSphere.fromPoints(positions);
  };

  const showOnlyEntities = (predicate) => {
    roomEntitiesRef.current.forEach((entity) => {
      entity.show = predicate(entity);
      if (entity.labelEntity) entity.labelEntity.show = false;
    });
  };

  const zoomToEntities = (entities, rangeMultiplier = 2.5, minRange = 25) => {
    const viewer = viewerRef.current;
    if (!viewer || !entities.length) return;

    const sphere = getBoundingSphereFromEntities(entities);
    if (!sphere) return;

    viewer.camera.flyToBoundingSphere(sphere, {
      duration: 1.5,
      offset: new Cesium.HeadingPitchRange(
        0,
        Cesium.Math.toRadians(-45),
        Math.max(sphere.radius * rangeMultiplier, minRange)
      ),
    });
  };

  const zoomToRoom = (roomNumber) => {
    const matches = roomEntitiesRef.current.filter(
      (e) => e.properties?.roomNumber?.getValue?.() === roomNumber
    );
    if (!matches.length) return;

    if (i3sProviderRef.current) i3sProviderRef.current.show = false;
    resetStylesAndLabels();

    showOnlyEntities(
      (e) => e.properties?.roomNumber?.getValue?.() === roomNumber
    );

    matches.forEach((entity) => {
      if (entity.polygon) {
        entity.polygon.material = Cesium.Color.CYAN.withAlpha(0.9);
      }
      if (entity.labelEntity) {
        entity.labelEntity.show = true;
      }
    });

    zoomToEntities(matches, 4, 15);

    const clickedEntity = matches[0];
    if (onFeatureClick && clickedEntity) {
      onFeatureClick({
        roomNumber: clickedEntity.properties.roomNumber?.getValue(),
        roomName: clickedEntity.properties.roomName?.getValue(),
        roomNameOriginal: clickedEntity.properties.roomNameOriginal?.getValue(),
        floor: clickedEntity.properties.floorLevel?.getValue(),
        area: clickedEntity.properties.area?.getValue(),
        temperature: clickedEntity.properties.temperature?.getValue(),
        humidity: clickedEntity.properties.humidity?.getValue(),
        co2: clickedEntity.properties.co2?.getValue(),
        occupancy: clickedEntity.properties.occupancy?.getValue(),
      });
    }
  };

  const zoomToFloor = (floor) => {
    const matches = roomEntitiesRef.current.filter(
      (e) => Number(e.properties?.floorLevel?.getValue?.()) === Number(floor)
    );
    if (!matches.length) return;

    if (i3sProviderRef.current) i3sProviderRef.current.show = false;
    resetStylesAndLabels();

    showOnlyEntities(
      (e) => Number(e.properties?.floorLevel?.getValue?.()) === Number(floor)
    );

    zoomToEntities(matches, 2.6, 30);
  };

  const zoomToBuilding = () => {
    const viewer = viewerRef.current;
    const provider = i3sProviderRef.current;
    if (!viewer || !provider?.extent) return;

    resetStylesAndLabels();
    provider.show = true;

    roomEntitiesRef.current.forEach((entity) => {
      entity.show = false;
      if (entity.labelEntity) entity.labelEntity.show = false;
    });

    const center = Cesium.Rectangle.center(provider.extent);
    center.height = 240;
    const destination =
      Cesium.Ellipsoid.WGS84.cartographicToCartesian(center);

    homeDestinationRef.current = destination;

    viewer.camera.flyTo({
      destination,
      duration: 1.5,
    });
  };

  const flyToCoordinates = (lat, lon, height = 500) => {
    const viewer = viewerRef.current;
    if (!viewer) return;

    resetStylesAndLabels();

    viewer.camera.flyTo({
      destination: Cesium.Cartesian3.fromDegrees(lon, lat, height),
      duration: 1.5,
    });
  };

  const handleEntityClick = (entity) => {
    if (!entity?.polygon) return;

    const roomNumber = entity.properties?.roomNumber?.getValue?.();
    if (!roomNumber) return;

    zoomToRoom(roomNumber);
  };

  useEffect(() => {
    if (!containerRef.current || viewerRef.current) return;

    let destroyed = false;

    const init = async () => {
      try {
        Cesium.Ion.defaultAccessToken =
          "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJqdGkiOiJlNDgxNjNjYS1kMTY1LTRhOTQtODFiZC1mYWMyNzY4OWVjN2YiLCJpZCI6MzQzOTQwLCJpYXQiOjE3NTg2MzQ0MTR9.pQiAchoUyxCsz38HgMWMnBs4ua7xTKPcbTE2s5EnbK4";

        const terrain = new Cesium.Terrain(
          Cesium.ArcGISTiledElevationTerrainProvider.fromUrl(
            "https://elevation3d.arcgis.com/arcgis/rest/services/WorldElevation3D/Terrain3D/ImageServer"
          )
        );

        const viewer = new Cesium.Viewer(containerRef.current, {
          terrain,
          animation: false,
          timeline: false,
          baseLayerPicker: false,
          geocoder: false,
          sceneModePicker: false,
          infoBox: false,
          selectionIndicator: false,
          shadows: false,
          homeButton: true,
        });

        viewerRef.current = viewer;

        viewer.shadows = false;
        viewer.terrainShadows = Cesium.ShadowMode.DISABLED;
        viewer.scene.globe.enableLighting = true;
        viewer.scene.globe.depthTestAgainstTerrain = true;
        viewer.scene.highDynamicRange = true;
        viewer.scene.fog.enabled = true;
        viewer.scene.fog.density = 0.0001;
        viewer.scene.fog.minimumBrightness = 0.8;
        viewer.scene.screenSpaceCameraController.enableCollisionDetection = true;

        const i3sProvider = await Cesium.I3SDataProvider.fromUrl(
          "https://tiles-eu1.arcgis.com/XYGfXK4rEYwaj5A0/arcgis/rest/services/Gate_export_20241104_r23_reduced_20241114_notex/SceneServer",
          {
            adjustMaterialAlphaMode: true,
            showFeatures: true,
            applySymbology: true,
            calculateNormals: true,
          }
        );

        if (destroyed) return;

        viewer.scene.primitives.add(i3sProvider);
        i3sProviderRef.current = i3sProvider;

        const response = await fetch("/floorplans/Floorplan_polygon_4326.geojson");
        const geojson = await response.json();

        if (destroyed) return;

        const createdRoomEntities = [];
        const floorsSet = new Set();
        const roomList = [];

        geojson.features.forEach((feature, idx) => {
          const props = feature.properties || {};
          const floorLevel = Number(props.BldgLevel ?? 0);
          const roomNumber = props.RoomNumber || `Room-${idx}`;
          const roomNameBulgarian = props.RoomName || "";
          const roomName = translateRoomName(roomNameBulgarian);
          const department = props.Department || "";
          const baseElevation = Number(props.BldgLevel_Elev ?? 0);
          const area = props.SourceArea;

          floorsSet.add(floorLevel);

          if (!roomList.find((r) => r.roomNumber === roomNumber)) {
            roomList.push({
              roomNumber,
              roomName,
              floorLevel,
            });
          }

          const roomData = getRoomData(roomName);
          const polygons = geometryToPolygons(feature.geometry, baseElevation);

          polygons.forEach((positions, polyIndex) => {
            const entity = viewer.entities.add({
              id: `${roomNumber}-${polyIndex}`,
              name: roomNumber,
              polygon: {
                hierarchy: new Cesium.PolygonHierarchy(positions),
                material: getRoomColor(roomName),
                extrudedHeight: baseElevation + 3.5,
                perPositionHeight: true,
                outline: true,
                outlineColor: Cesium.Color.BLACK.withAlpha(0.85),
                outlineWidth: 2,
                shadows: Cesium.ShadowMode.DISABLED,
              },
              properties: {
                roomNumber,
                roomName,
                roomNameOriginal: roomNameBulgarian,
                floorLevel,
                department,
                area,
                temperature: roomData.temp,
                humidity: roomData.humidity,
                co2: roomData.co2,
                occupancy: roomData.occupancy,
              },
              show: false,
            });

            entity.originalMaterial = entity.polygon.material;
            createdRoomEntities.push(entity);
          });
        });

        const groupedByRoom = new Map();

        createdRoomEntities.forEach((entity) => {
          const roomNumber = entity.properties.roomNumber.getValue();
          if (!groupedByRoom.has(roomNumber)) {
            groupedByRoom.set(roomNumber, []);
          }
          groupedByRoom.get(roomNumber).push(entity);
        });

        groupedByRoom.forEach((entities) => {
          const sphere = getBoundingSphereFromEntities(entities);
          if (!sphere) return;

          const first = entities[0];
          const cartographic = Cesium.Cartographic.fromCartesian(sphere.center);
          const baseElevation =
            first.polygon.extrudedHeight.getValue() - 3.5;

          const labelEntity = viewer.entities.add({
            position: Cesium.Cartesian3.fromRadians(
              cartographic.longitude,
              cartographic.latitude,
              baseElevation + 4.1
            ),
            label: {
              text: `${first.properties.roomName.getValue()}\n🌡 ${first.properties.temperature.getValue()}°C  💧 ${first.properties.humidity.getValue()}%  🧑 ${first.properties.occupancy.getValue()}`,
              font: "bold 15px Arial",
              fillColor: Cesium.Color.WHITE,
              outlineColor: Cesium.Color.BLACK,
              outlineWidth: 3,
              style: Cesium.LabelStyle.FILL_AND_OUTLINE,
              verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
              pixelOffset: new Cesium.Cartesian2(0, -12),
              disableDepthTestDistance: Number.POSITIVE_INFINITY,
              showBackground: true,
              backgroundColor: Cesium.Color.BLACK.withAlpha(0.72),
              backgroundPadding: new Cesium.Cartesian2(8, 6),
            },
            show: false,
          });

          entities.forEach((entity) => {
            entity.labelEntity = labelEntity;
          });
        });

        roomEntitiesRef.current = createdRoomEntities;
        setAvailableFloors(Array.from(floorsSet).sort((a, b) => a - b));
        setAvailableRooms(
          roomList.sort((a, b) => {
            if (a.floorLevel !== b.floorLevel) return a.floorLevel - b.floorLevel;
            return String(a.roomNumber).localeCompare(String(b.roomNumber), undefined, {
              numeric: true,
              sensitivity: "base",
            });
          })
        );

        const center = Cesium.Rectangle.center(i3sProvider.extent);
        center.height = 240;
        const destination =
          Cesium.Ellipsoid.WGS84.cartographicToCartesian(center);

        homeDestinationRef.current = destination;
        viewer.camera.setView({ destination });

        viewer.homeButton.viewModel.command.beforeExecute.addEventListener((e) => {
          e.cancel = true;
          zoomToBuilding();
        });

        viewer.screenSpaceEventHandler.setInputAction((click) => {
          const picked = viewer.scene.pick(click.position);
          if (!Cesium.defined(picked) || !picked.id || !picked.id.polygon) return;
          handleEntityClick(picked.id);
        }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

        setLoading(false);
      } catch (e) {
        console.error("Viewer initialization failed:", e);
        setLoading(false);
      }
    };

    init();

    return () => {
      destroyed = true;
      if (viewerRef.current && !viewerRef.current.isDestroyed()) {
        viewerRef.current.destroy();
      }
      viewerRef.current = null;
      i3sProviderRef.current = null;
      roomEntitiesRef.current = [];
    };
  }, [onFeatureClick]);

  useEffect(() => {
    const handleCesiumCommand = (cmd) => {
      const viewer = viewerRef.current;
      if (!viewer || cmd?.type !== "cesium") return;

      switch (cmd.action) {
        case "fly_to_coordinates": {
          flyToCoordinates(cmd.lat, cmd.lon, cmd.height ?? 500);
          break;
        }

        case "zoom_to_room": {
          zoomToRoom(cmd.room_number);
          break;
        }

        case "zoom_to_floor": {
          zoomToFloor(cmd.floor);
          break;
        }

        case "zoom_to_building": {
          zoomToBuilding();
          break;
        }

        case "show_building": {
          if (i3sProviderRef.current) i3sProviderRef.current.show = true;
          break;
        }

        case "hide_building": {
          if (i3sProviderRef.current) i3sProviderRef.current.show = false;
          break;
        }

        case "reset_view": {
          zoomToBuilding();
          break;
        }

        default:
          break;
      }
    };

    const listener = (event) => handleCesiumCommand(event.detail);

    window.addEventListener("cesium-command", listener);
    return () => window.removeEventListener("cesium-command", listener);
  }, []);

  return (
    <div style={{ width: "100%", height: "100%", position: "relative" }}>
      {loading && (
        <div
          style={{
            position: "absolute",
            zIndex: 20,
            top: 16,
            left: 16,
            background: "rgba(0,0,0,0.75)",
            color: "#fff",
            padding: "10px 14px",
            borderRadius: 8,
            fontSize: 14,
          }}
        >
          Loading 3D building…
        </div>
      )}

      <div ref={containerRef} style={{ width: "100%", height: "100%" }} />

      <div
        style={{
          position: "absolute",
          top: 16,
          left: 16,
          zIndex: 15,
          width: 260,
          maxHeight: "calc(100% - 32px)",
          overflow: "auto",
          background: "rgba(20,20,20,0.88)",
          color: "#fff",
          borderRadius: 10,
          padding: 12,
          boxShadow: "0 8px 24px rgba(0,0,0,0.35)",
          backdropFilter: "blur(4px)",
        }}
      >
        <div style={{ fontWeight: 700, marginBottom: 10 }}>
          Building Controls
        </div>

        <button
          onClick={zoomToBuilding}
          style={{
            width: "100%",
            padding: "10px 12px",
            borderRadius: 8,
            border: "none",
            cursor: "pointer",
            marginBottom: 10,
          }}
        >
          Show Whole Building
        </button>

        <div style={{ fontSize: 13, opacity: 0.9, marginBottom: 6 }}>
          Zoom to floor
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 14 }}>
          {availableFloors.map((floor) => (
            <button
              key={floor}
              onClick={() => zoomToFloor(floor)}
              style={{
                padding: "8px 10px",
                borderRadius: 8,
                border: "none",
                cursor: "pointer",
              }}
            >
              Floor {floor}
            </button>
          ))}
        </div>

        <div style={{ fontSize: 13, opacity: 0.9, marginBottom: 6 }}>
          Zoom to room
        </div>

        <select
          value={selectedRoom}
          onChange={(e) => setSelectedRoom(e.target.value)}
          style={{
            width: "100%",
            padding: "10px 12px",
            borderRadius: 8,
            marginBottom: 8,
          }}
        >
          <option value="">Select a room</option>
          {availableRooms.map((room) => (
            <option key={`${room.roomNumber}-${room.floorLevel}`} value={room.roomNumber}>
              {room.roomNumber} — {room.roomName} (F{room.floorLevel})
            </option>
          ))}
        </select>

        <button
          onClick={() => {
            if (selectedRoom) zoomToRoom(selectedRoom);
          }}
          disabled={!selectedRoom}
          style={{
            width: "100%",
            padding: "10px 12px",
            borderRadius: 8,
            border: "none",
            cursor: selectedRoom ? "pointer" : "not-allowed",
            opacity: selectedRoom ? 1 : 0.5,
            marginBottom: 12,
          }}
        >
          Zoom to Selected Room
        </button>

        <div style={{ fontSize: 12, opacity: 0.75, lineHeight: 1.5 }}>
          Chatbot commands can dispatch:
          <br />
          <code style={{ color: "#9ad1ff" }}>fly_to_coordinates</code>
          <br />
          <code style={{ color: "#9ad1ff" }}>zoom_to_floor</code>
          <br />
          <code style={{ color: "#9ad1ff" }}>zoom_to_room</code>
          <br />
          <code style={{ color: "#9ad1ff" }}>reset_view</code>
        </div>
      </div>
    </div>
  );
}