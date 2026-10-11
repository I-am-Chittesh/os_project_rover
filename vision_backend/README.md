# Honeybadger vision backend

This service captures the local webcam, runs YOLOv8 Nano, and exposes the
annotated feed used by the dashboard.

## Run locally

From the repository root:

```powershell
py -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r vision_backend\requirements.txt
python -m uvicorn vision_backend.main:app --host 127.0.0.1 --port 8000
```

The first startup downloads `yolov8n.pt` from Ultralytics. Open the dashboard
at `http://localhost:3000` after the backend is running.

Endpoints:

- `GET /health` - pipeline readiness and measured FPS
- `GET /video_feed` - low-latency MJPEG stream with YOLO annotations
- `GET /detections` - latest detections for the dashboard activity log

Optional environment variables:

- `YOLO_MODEL` (default `yolov8n.pt`)
- `CAMERA_INDEX` (default `0`)
- `YOLO_CONFIDENCE` (default `0.35`)
- `CAMERA_WIDTH` / `CAMERA_HEIGHT` (defaults `1280` / `720`)

The default COCO model is a development baseline. A custom pest/obstacle
model can be used by setting `YOLO_MODEL` to its `.pt` path.
