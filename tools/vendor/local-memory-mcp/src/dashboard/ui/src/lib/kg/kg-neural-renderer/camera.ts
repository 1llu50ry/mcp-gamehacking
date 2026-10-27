/**
 * Camera state management and control for the Knowledge Graph Neural Renderer.
 *
 * Manages zoom, drag, and auto-rotation state.
 */

import {
	CAMERA_DISTANCE,
	ZOOM_LERP,
	ZOOM_MIN,
	ZOOM_MAX,
	DRAG_SENSITIVITY,
	AUTO_ROTATE_RESUME_MS,
	CAMERA_ROTATION_SPEED,
	CAMERA_TILT_AMOUNT,
	FOCAL_LENGTH
} from "./layout";

// ─── Camera / Zoom / Drag State ─────────────────────────────────────────────

let cameraDistance = CAMERA_DISTANCE;
let targetCameraDistance = CAMERA_DISTANCE;

let manualRotY = 0;
let manualRotX = 0;
let isDragging = false;
let lastMouseX = 0;
let lastMouseY = 0;

// Auto-rotation
let isAutoRotating = true;
let autoRotAngle = 0;
let autoTiltAngle = 0;
let lastAutoTimestamp = 0;
let lastInteractionTime = 0;

// ─── Camera Control API ─────────────────────────────────────────────────────

export function zoomCamera(delta: number): void {
	targetCameraDistance *= Math.pow(0.95, delta);
	targetCameraDistance = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, targetCameraDistance));
}

export function startDragCamera(x: number, y: number): void {
	isDragging = true;
	lastMouseX = x;
	lastMouseY = y;
	isAutoRotating = false;
}

export function dragCamera(x: number, y: number): void {
	if (!isDragging) return;
	const dx = x - lastMouseX;
	const dy = y - lastMouseY;
	manualRotY += dx * DRAG_SENSITIVITY;
	manualRotX += dy * DRAG_SENSITIVITY;
	manualRotX = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, manualRotX));
	lastMouseX = x;
	lastMouseY = y;
	lastInteractionTime = performance.now();
}

export function endDragCamera(): void {
	if (!isDragging) return;
	isDragging = false;
	lastInteractionTime = performance.now();
}

export function resetCamera(): void {
	targetCameraDistance = CAMERA_DISTANCE;
	manualRotY = 0;
	manualRotX = 0;
	isAutoRotating = true;
	autoRotAngle = 0;
	autoTiltAngle = 0;
	lastAutoTimestamp = 0;
}

export function getZoomPercent(): number {
	return Math.round((CAMERA_DISTANCE / targetCameraDistance) * 100);
}

export function isCameraDragging(): boolean {
	return isDragging;
}

/**
 * True while the zoom lerp is still converging (`cameraDistance` has not yet
 * reached `targetCameraDistance`). Used by the renderer's settle detector
 * (TASK-277) as an "interaction activity" signal so the graph keeps rendering
 * through a zoom animation and only freezes once the lerp settles.
 */
export function isZoomAnimating(): boolean {
	return Math.abs(cameraDistance - targetCameraDistance) > 0.5;
}

/**
 * Re-anchors the auto-rotation clock to `now` on the next `updateCamera`
 * call. The renderer calls this after a freeze gap so the first resumed frame
 * does not compute a huge `autoDt` (which would teleport the camera rotation
 * across the time the loop was frozen) (TASK-277).
 */
export function resetAutoRotationClock(): void {
	lastAutoTimestamp = 0;
}

// ─── Frame update (called once per render frame) ───────────────────────────

export interface CameraFrame {
	effectiveFocalLength: number;
	rotY: number;
	rotX: number;
}

export function updateCamera(now: number, isZeroEdge: boolean, totalElapsed: number): CameraFrame {
	// Smooth zoom lerp
	cameraDistance += (targetCameraDistance - cameraDistance) * ZOOM_LERP;

	// Dynamic focal length based on camera distance
	const effectiveFocalLength = FOCAL_LENGTH * (CAMERA_DISTANCE / cameraDistance);

	// Auto-rotation resume after idle
	if (!isAutoRotating && !isDragging && lastInteractionTime > 0) {
		if (performance.now() - lastInteractionTime > AUTO_ROTATE_RESUME_MS) {
			isAutoRotating = true;
			lastAutoTimestamp = now;
		}
	}

	// Camera rotation
	if (!isZeroEdge && isAutoRotating) {
		if (lastAutoTimestamp === 0) lastAutoTimestamp = now;
		const autoDt = now - lastAutoTimestamp;
		autoRotAngle += autoDt * CAMERA_ROTATION_SPEED;
		autoTiltAngle = Math.sin(totalElapsed * 0.00004) * CAMERA_TILT_AMOUNT;
	}
	if (isAutoRotating) lastAutoTimestamp = now;

	const rotY = isZeroEdge ? 0 : autoRotAngle + manualRotY;
	const rotX = isZeroEdge ? 0 : autoTiltAngle + manualRotX;

	return { effectiveFocalLength, rotY, rotX };
}

export { isDragging };
