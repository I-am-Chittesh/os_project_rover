"use client";

import { AnimatePresence, motion } from "framer-motion";
import {
  Activity,
  BatteryCharging,
  Camera,
  CheckCircle2,
  ChevronDown,
  Download,
  Gauge,
  LocateFixed,
  LayoutDashboard,
  Map,
  Radio,
  ScanSearch,
  Settings,
  Signal,
  Sparkles,
  SlidersHorizontal,
  Waves,
  Wifi,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

type Detection = {
  bbox: [number, number, number, number];
  class: string;
  score: number;
  born: number;
};
type EventItem = {
  id: number;
  timestamp: string;
  label: string;
  confidence: number;
  thumbnail_base64: string;
};
type Telemetry = {
  signal: number;
  battery: number;
  terrain: string;
  speed: number;
};

const accents = ["#ff5c8a", "#7767ff", "#00bfa6", "#ffb000"];
const terrainNames = ["MEADOW", "GRAVEL", "LOAM", "WETLAND"];

function Metric({
  icon: Icon,
  label,
  value,
  unit,
  color,
}: {
  icon: typeof Activity;
  label: string;
  value: string;
  unit?: string;
  color: string;
}) {
  return (
    <motion.div
      className="metric-card"
      layout
      whileHover={{ y: -3, scale: 1.015 }}
      transition={{ type: "spring", stiffness: 420, damping: 18 }}
    >
      <span className="metric-icon" style={{ background: `${color}1c`, color }}>
        <Icon size={17} />
      </span>
      <span className="metric-copy">
        <span className="eyebrow">{label}</span>
        <strong>
          {value}
          <small>{unit}</small>
        </strong>
      </span>
      <span className="metric-pulse" style={{ background: color }} />
    </motion.div>
  );
}

function MapPanel() {
  return (
    <div className="map-panel">
      <div className="map-topline">
        <span>
          <Map size={14} /> FIELD GRID 04
        </span>
        <span className="live-chip">
          <i /> LIVE
        </span>
      </div>
      <div className="map-art">
        <div className="route route-one" />
        <div className="route route-two" />
        <div className="contour contour-one" />
        <div className="contour contour-two" />
        <motion.div
          className="location-marker"
          animate={{
            scale: [1, 1.22, 1],
            boxShadow: [
              "0 0 0 0 #ff5c8a44",
              "0 0 0 17px #ff5c8a00",
              "0 0 0 0 #ff5c8a44",
            ],
          }}
          transition={{ duration: 2, repeat: Infinity, ease: "easeOut" }}
        >
          <LocateFixed size={16} />
        </motion.div>
        <span className="map-label label-a">NORTH RIDGE</span>
        <span className="map-label label-b">SECTOR 04</span>
      </div>
      <div className="coordinates">
        <span>
          <LocateFixed size={12} /> 14 deg 32&apos; 08.1&quot; N
        </span>
        <span>76 deg 41&apos; 22.8&quot; W</span>
      </div>
    </div>
  );
}

function CameraOverlay({
  detections,
  width,
  height,
}: {
  detections: Detection[];
  width: number;
  height: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !width || !height) return;
    const scale = window.devicePixelRatio || 1;
    canvas.width = width * scale;
    canvas.height = height * scale;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    const context = canvas.getContext("2d");
    if (!context) return;
    context.scale(scale, scale);
    context.clearRect(0, 0, width, height);
    detections.forEach((detection, index) => {
      const [x, y, boxWidth, boxHeight] = detection.bbox;
      const progress = Math.min(1, (performance.now() - detection.born) / 280);
      const eased = 1 - Math.pow(1 - progress, 3);
      const color = accents[index % accents.length];
      const centerX = x + boxWidth / 2;
      const centerY = y + boxHeight / 2;
      const drawWidth = boxWidth * eased;
      const drawHeight = boxHeight * eased;
      const drawX = centerX - drawWidth / 2;
      const drawY = centerY - drawHeight / 2;
      context.strokeStyle = color;
      context.lineWidth = 2;
      context.setLineDash([8, 5]);
      context.strokeRect(drawX, drawY, drawWidth, drawHeight);
      context.setLineDash([]);
      context.fillStyle = color;
      context.font = '700 11px -apple-system, BlinkMacSystemFont, "Helvetica Neue", sans-serif';
      const tag = `${detection.class.toUpperCase()}  ${Math.round(detection.score * 100)}%`;
      const tagWidth = context.measureText(tag).width + 16;
      context.fillRect(drawX, Math.max(0, drawY - 24), tagWidth, 22);
      context.fillStyle = "#fff";
      context.fillText(tag, drawX + 8, Math.max(15, drawY - 9));
    });
  }, [detections, width, height]);
  return (
    <canvas
      ref={canvasRef}
      className="detection-canvas"
      aria-label="Object detection overlay"
    />
  );
}

export default function Home() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const frameRef = useRef<HTMLCanvasElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number | null>(null);
  const lastLogRef = useRef<Record<string, number>>({});
  const [cameraState, setCameraState] = useState("REQUESTING CAMERA");
  const [modelState, setModelState] = useState("LOADING VISION MODEL");
  const [detections, setDetections] = useState<Detection[]>([]);
  const [events, setEvents] = useState<EventItem[]>([]);
  const [viewport, setViewport] = useState({ width: 0, height: 0 });
  const [adminMenuOpen, setAdminMenuOpen] = useState(false);
  const [adminAction, setAdminAction] = useState("Mission overview");
  const [cameraPaused, setCameraPaused] = useState(false);
  const [showSystemSettings, setShowSystemSettings] = useState(false);
  const [telemetry, setTelemetry] = useState<Telemetry>({
    signal: 96,
    battery: 84,
    terrain: "MEADOW",
    speed: 1.8,
  });

  const captureEvent = useCallback(
    (
      label: string,
      confidence: number,
      bbox: [number, number, number, number],
    ) => {
      const canvas = frameRef.current;
      const video = videoRef.current;
      if (!canvas || !video || video.readyState < 2) return;
      const [x, y, width, height] = bbox;
      canvas.width = Math.max(80, width);
      canvas.height = Math.max(60, height);
      canvas
        .getContext("2d")
        ?.drawImage(
          video,
          x,
          y,
          width,
          height,
          0,
          0,
          canvas.width,
          canvas.height,
        );
      const thumbnail = canvas.toDataURL("image/jpeg", 0.76);
      setEvents((current) =>
        [
          {
            id: Date.now(),
            timestamp: new Date().toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
              second: "2-digit",
            }),
            label,
            confidence,
            thumbnail_base64: thumbnail,
          },
          ...current,
        ].slice(0, 8),
      );
    },
    [],
  );

  useEffect(() => {
    let stream: MediaStream | undefined;
    let cancelled = false;
    async function startCamera() {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: "user",
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
          audio: false,
        });
        if (cancelled || !videoRef.current) return;
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
        setCameraState("CAMERA ONLINE");
      } catch {
        setCameraState("CAMERA UNAVAILABLE");
      }
    }
    startCamera();
    return () => {
      cancelled = true;
      stream?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  useEffect(() => {
    const observer = new ResizeObserver(([entry]) =>
      setViewport({
        width: entry.contentRect.width,
        height: entry.contentRect.height,
      }),
    );
    if (viewportRef.current) observer.observe(viewportRef.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const interval = window.setInterval(
      () =>
        setTelemetry((current) => ({
          signal: Math.max(
            92,
            Math.min(
              98,
              current.signal + Math.round((Math.random() - 0.5) * 3),
            ),
          ),
          battery: Math.max(
            0,
            current.battery - (Math.random() > 0.72 ? 0.1 : 0),
          ),
          terrain:
            terrainNames[Math.floor(Math.random() * terrainNames.length)],
          speed: Math.max(
            0.4,
            Math.min(3.8, current.speed + (Math.random() - 0.5) * 0.3),
          ),
        })),
      3400,
    );
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    let cancelled = false;
    let model: {
      detect: (
        video: HTMLVideoElement,
      ) => Promise<
        Array<{
          bbox: [number, number, number, number];
          class: string;
          score?: number;
        }>
      >;
    } | null = null;
    let frameCount = 0;
    async function loadModel() {
      try {
        const coco = await import("@tensorflow-models/coco-ssd");
        model = await coco.load({ base: "lite_mobilenet_v2" });
        if (!cancelled) setModelState("VISION MODEL READY");
        const loop = async () => {
          if (cancelled) return;
          const video = videoRef.current;
          if (
            model &&
            video &&
            video.readyState >= 2 &&
            frameCount++ % 7 === 0
          ) {
            const predictions = await model.detect(video);
            if (!cancelled) {
              const next = predictions
                .filter((item) => (item.score || 0) > 0.35)
                .map((item) => ({
                  bbox: item.bbox,
                  class: item.class,
                  score: item.score || 0,
                  born: performance.now(),
                }));
              setDetections(next);
              next
                .filter((item) => item.score > 0.6)
                .forEach((item) => {
                  const previous = lastLogRef.current[item.class] || 0;
                  if (Date.now() - previous > 3000) {
                    lastLogRef.current[item.class] = Date.now();
                    captureEvent(item.class, item.score, item.bbox);
                  }
                });
            }
          }
          rafRef.current = requestAnimationFrame(loop);
        };
        loop();
      } catch {
        if (!cancelled) setModelState("VISION MODEL OFFLINE");
      }
    }
    loadModel();
    return () => {
      cancelled = true;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [captureEvent]);

  const selectAdminAction = (label: string) => {
    setAdminAction(label);
    setAdminMenuOpen(false);
    if (label === "Camera controls") {
      setCameraPaused((paused) => {
        const nextPaused = !paused;
        if (nextPaused) videoRef.current?.pause();
        else void videoRef.current?.play();
        return nextPaused;
      });
    }
    if (label === "System settings") setShowSystemSettings((open) => !open);
    if (label === "Export session") {
      const payload = JSON.stringify(
        { product: "honeybadger", exportedAt: new Date().toISOString(), events },
        null,
        2,
      );
      const url = URL.createObjectURL(new Blob([payload], { type: "application/json" }));
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = "honeybadger-session.json";
      anchor.click();
      URL.revokeObjectURL(url);
    }
  };

  return (
    <main className="sentinel-app">
      <header className="topbar">
        <div className="brand-lockup">
          <div className="brand-mark">
            <Sparkles size={19} />
          </div>
          <div>
            <p className="brand-name">honeybadger.</p>
            <p className="brand-subtitle">FIELD INTELLIGENCE / ROVER 01</p>
          </div>
        </div>
        <div className="mission-status">
          <span className="status-dot" /> MISSION ACTIVE{" "}
          <span className="status-divider" />{" "}
          <span className="muted-label">UPTIME</span> 04:18:32
        </div>
        <div className="admin-control">
          <button
            className="operator-button"
            aria-label="Open admin controls"
            aria-expanded={adminMenuOpen}
            onClick={() => setAdminMenuOpen((open) => !open)}
          >
            <span>AD</span>
            <strong>ADMIN</strong>
            <small>CONTROL</small>
            <ChevronDown className={adminMenuOpen ? "chevron-open" : ""} size={14} />
          </button>
          <AnimatePresence>
            {adminMenuOpen && (
              <motion.div
                className="admin-menu"
                initial={{ opacity: 0, y: -8, scale: 0.96 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -8, scale: 0.96 }}
                transition={{ type: "spring", stiffness: 420, damping: 24 }}
              >
                <span className="admin-menu-label">ADMIN OPTIONS</span>
                {[
                  [LayoutDashboard, "Mission overview"],
                  [SlidersHorizontal, "Camera controls"],
                  [Download, "Export session"],
                  [Settings, "System settings"],
                ].map(([Icon, label]) => (
                  <button
                    className={adminAction === label ? "admin-option active" : "admin-option"}
                    key={label as string}
                    onClick={() => selectAdminAction(label as string)}
                  >
                    <Icon size={15} />
                    <span>{label as string}</span>
                    {adminAction === label && <i />}
                  </button>
                ))}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </header>
      <section className="dashboard-grid">
        <aside className="left-rail">
          <div className="section-heading">
            <div>
              <span className="eyebrow">NAVIGATION</span>
              <h2>ROVER POSITION</h2>
            </div>
            <span className="section-number">01</span>
          </div>
          <MapPanel />
          <div className="section-heading telemetry-heading">
            <div>
              <span className="eyebrow">LIVE TELEMETRY</span>
              <h2>SYSTEM PULSE</h2>
            </div>
            <Activity size={17} />
          </div>
          <div className="metrics-stack">
            <Metric
              icon={Signal}
              label="Signal strength"
              value={`${telemetry.signal}%`}
              color="#00bfa6"
            />
            <Metric
              icon={BatteryCharging}
              label="Battery status"
              value={`${Math.round(telemetry.battery)}%`}
              color="#ffb000"
            />
            <Metric
              icon={Waves}
              label="Current terrain"
              value={telemetry.terrain}
              color="#7767ff"
            />
            <Metric
              icon={Gauge}
              label="Cruise speed"
              value={telemetry.speed.toFixed(1)}
              unit="m/s"
              color="#ff5c8a"
            />
          </div>
          <div className="rail-footer">
            <Wifi size={14} /> MESH LINK <span>STABLE</span>
          </div>
        </aside>
        <section className="vision-column">
          <div className="section-heading vision-heading">
            <div>
              <span className="eyebrow">VISION CENTER / CAM-01</span>
              <h1>
                THE FIELD, <em>IN FOCUS.</em>
              </h1>
            </div>
            <div className="model-badge">
              <ScanSearch size={15} /> {showSystemSettings ? "SYSTEM SETTINGS" : modelState}
            </div>
          </div>
          <div className="vision-frame" ref={viewportRef}>
            <video
              ref={videoRef}
              className="vision-video"
              muted
              playsInline
              aria-label="Rover camera feed"
            />
            {cameraState !== "CAMERA ONLINE" && (
              <div className="camera-placeholder">
                <Camera size={30} />
                <strong>{cameraState}</strong>
                <span>Allow camera access to begin local vision capture</span>
              </div>
            )}
            <CameraOverlay
              detections={detections}
              width={viewport.width}
              height={viewport.height}
            />
            <div className="camera-status">
              <span className="recording-dot" /> CAM-01: {cameraPaused ? "PAUSED" : "ACTIVE"}{" "}
              <small>LOCAL FEED</small>
            </div>
            <div className="frame-corner corner-tl" />
            <div className="frame-corner corner-tr" />
            <div className="frame-corner corner-bl" />
            <div className="frame-corner corner-br" />
            <div className="vision-footer">
              <span>
                <Radio size={13} /> 1280 x 720
              </span>
              <span>
                AI SCAN <b>{detections.length ? "TRACKING" : "STANDBY"}</b>
              </span>
            </div>
          </div>
          <div className="vision-note">
            <CheckCircle2 size={16} />
            <span>
              All inference happens locally in your browser. No field imagery
              leaves this device.
            </span>
            <span className="privacy-tag">PRIVATE BY DEFAULT</span>
          </div>
        </section>
        <aside className="event-rail">
          <div className="section-heading">
            <div>
              <span className="eyebrow">ACTIVITY LOG</span>
              <h2>RECENT SIGHTINGS</h2>
            </div>
            <span className="event-count">
              {events.length.toString().padStart(2, "0")}
            </span>
          </div>
          <div className="event-list">
            <AnimatePresence initial={false}>
              {events.length === 0 ? (
                <motion.div
                  className="empty-events"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                >
                  <ScanSearch size={22} />
                  <strong>Scanning the perimeter</strong>
                  <span>Qualifying detections will appear here.</span>
                </motion.div>
              ) : (
                events.map((event, index) => (
                  <motion.article
                    className="event-card"
                    key={event.id}
                    layout
                    initial={{ opacity: 0, y: -28, scale: 0.94 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.9, x: 40 }}
                    transition={{
                      type: "spring",
                      stiffness: 430,
                      damping: 24,
                      delay: index === 0 ? 0.04 : 0,
                    }}
                  >
                    <div className="event-thumb">
                      <img
                        src={event.thumbnail_base64}
                        alt={`${event.label} detected`}
                      />
                      <span className="thumb-index">0{index + 1}</span>
                    </div>
                    <div className="event-detail">
                      <span className="event-time">
                        {event.timestamp} <i>â€¢</i> AUTO-LOGGED
                      </span>
                      <strong>{event.label}</strong>
                      <span className="confidence">
                        <span style={{ width: `${event.confidence * 100}%` }} />{" "}
                        {Math.round(event.confidence * 100)}% confidence
                      </span>
                    </div>
                  </motion.article>
                ))
              )}
            </AnimatePresence>
          </div>
          <div className="event-footer">
            <span>
              <span className="legend-dot" /> THRESHOLD 60%
            </span>
            <span>MAX 08 EVENTS</span>
          </div>
        </aside>
      </section>
      <canvas ref={frameRef} className="offscreen-canvas" aria-hidden="true" />
    </main>
  );
}
