"""Local YOLOv8 Nano webcam service for the Honeybadger dashboard."""

from __future__ import annotations

import os
import threading
import time
from contextlib import asynccontextmanager
from typing import Any

import cv2
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from ultralytics import YOLO


MODEL_PATH = os.getenv("YOLO_MODEL", "yolov8n.pt")
CAMERA_INDEX = int(os.getenv("CAMERA_INDEX", "0"))
CONFIDENCE_THRESHOLD = float(os.getenv("YOLO_CONFIDENCE", "0.35"))
FRAME_WIDTH = int(os.getenv("CAMERA_WIDTH", "1280"))
FRAME_HEIGHT = int(os.getenv("CAMERA_HEIGHT", "720"))


class VisionPipeline:
    def __init__(self) -> None:
        self.model: YOLO | None = None
        self.capture: cv2.VideoCapture | None = None
        self.thread: threading.Thread | None = None
        self.stop_event = threading.Event()
        self.condition = threading.Condition()
        self.latest_frame: bytes | None = None
        self.latest_detections: list[dict[str, Any]] = []
        self.frame_number = 0
        self.fps = 0.0
        self.error: str | None = None

    def start(self) -> None:
        try:
            self.model = YOLO(MODEL_PATH)
            self.capture = cv2.VideoCapture(CAMERA_INDEX)
            self.capture.set(cv2.CAP_PROP_FRAME_WIDTH, FRAME_WIDTH)
            self.capture.set(cv2.CAP_PROP_FRAME_HEIGHT, FRAME_HEIGHT)
            if not self.capture.isOpened():
                raise RuntimeError(f"Unable to open webcam at index {CAMERA_INDEX}")
        except Exception as exc:
            self.error = str(exc)
            self.close()
            return

        self.thread = threading.Thread(target=self._run, name="vision-pipeline", daemon=True)
        self.thread.start()

    def close(self) -> None:
        self.stop_event.set()
        if self.capture is not None:
            self.capture.release()
            self.capture = None
        if self.thread is not None and self.thread.is_alive():
            self.thread.join(timeout=2)

    def _run(self) -> None:
        assert self.capture is not None
        assert self.model is not None
        last_time = time.perf_counter()

        while not self.stop_event.is_set():
            success, frame = self.capture.read()
            if not success:
                self.error = "Webcam frame capture failed"
                time.sleep(0.1)
                continue

            result = self.model.predict(
                frame,
                imgsz=640,
                conf=CONFIDENCE_THRESHOLD,
                verbose=False,
            )[0]
            detections: list[dict[str, Any]] = []
            for box in result.boxes:
                coordinates = box.xyxy[0].tolist()
                class_id = int(box.cls[0].item())
                detections.append(
                    {
                        "bbox": [round(value, 1) for value in coordinates],
                        "class": self.model.names[class_id],
                        "score": round(float(box.conf[0].item()), 3),
                    }
                )

            annotated = result.plot()
            encoded, buffer = cv2.imencode(
                ".jpg",
                annotated,
                [int(cv2.IMWRITE_JPEG_QUALITY), 82],
            )
            if not encoded:
                continue

            now = time.perf_counter()
            elapsed = now - last_time
            last_time = now
            with self.condition:
                self.latest_frame = buffer.tobytes()
                self.latest_detections = detections
                self.frame_number += 1
                self.fps = 1 / elapsed if elapsed else 0
                self.error = None
                self.condition.notify_all()

    def frame_stream(self):
        last_frame_number = -1
        while not self.stop_event.is_set():
            with self.condition:
                self.condition.wait_for(
                    lambda: self.frame_number != last_frame_number or self.stop_event.is_set(),
                    timeout=1,
                )
                frame = self.latest_frame
                last_frame_number = self.frame_number
            if frame is None:
                continue
            yield (
                b"--frame\r\n"
                b"Content-Type: image/jpeg\r\n"
                b"Cache-Control: no-cache\r\n\r\n"
                + frame
                + b"\r\n"
            )


pipeline = VisionPipeline()


@asynccontextmanager
async def lifespan(_: FastAPI):
    pipeline.start()
    yield
    pipeline.close()


app = FastAPI(title="Honeybadger Vision Backend", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://127.0.0.1:3000",
    ],
    allow_methods=["GET"],
    allow_headers=["*"],
)


@app.get("/health")
def health() -> dict[str, Any]:
    if pipeline.error and pipeline.latest_frame is None:
        raise HTTPException(status_code=503, detail=pipeline.error)
    return {
        "status": "ok",
        "model": MODEL_PATH,
        "camera_index": CAMERA_INDEX,
        "fps": round(pipeline.fps, 1),
    }


@app.get("/detections")
def detections() -> dict[str, Any]:
    if pipeline.latest_frame is None:
        raise HTTPException(status_code=503, detail=pipeline.error or "Vision pipeline is starting")
    with pipeline.condition:
        return {
            "detections": pipeline.latest_detections,
            "frame_number": pipeline.frame_number,
            "fps": round(pipeline.fps, 1),
        }


@app.get("/video_feed")
def video_feed() -> StreamingResponse:
    if pipeline.latest_frame is None:
        raise HTTPException(status_code=503, detail=pipeline.error or "Vision pipeline is starting")
    return StreamingResponse(
        pipeline.frame_stream(),
        media_type="multipart/x-mixed-replace; boundary=frame",
        headers={"Cache-Control": "no-cache", "Pragma": "no-cache"},
    )
