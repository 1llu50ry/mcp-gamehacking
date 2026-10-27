/**
 * Knowledge Graph Neural Renderer — barrel re‑export.
 *
 * All implementation lives under `kg-neural-renderer/`.
 */
export {
	startNeuralAnimation,
	stopNeuralAnimation,
	pauseNeuralAnimation,
	resumeNeuralAnimation,
	isNeuralAnimationRunning,
	wakeNeuralAnimation,
	updateNeuralDimensions,
	updateAnimationData,
	zoomCamera,
	startDragCamera,
	dragCamera,
	endDragCamera,
	resetCamera,
	getZoomPercent,
	isCameraDragging,
	queryNodeCandidates,
	isSpatialGridReady
} from "./kg-neural-renderer/index";
export type { NeuralRenderState } from "./kg-neural-renderer/index";
