// Shared chimera-desktop UI state. Kept small on purpose — anything that
// belongs in upstream's stores (settings, conversations, etc.) lives there;
// this is only for state the chimera-desktop shell owns.

import { getChimeraBaseUrl } from './sidecar';

export type ChimeraPanel = 'none' | 'rag' | 'audio' | 'image' | 'rerank' | 'lora';

interface ShellState {
	activePanel: ChimeraPanel;
	sidecarBaseUrl: string | null;
	sidecarStatus: 'unknown' | 'starting' | 'running' | 'failed' | 'exited';
	loadedModel: string | null;
}

function createShellState() {
	let state = $state<ShellState>({
		activePanel: 'none',
		sidecarBaseUrl: null,
		sidecarStatus: 'unknown',
		loadedModel: null
	});

	return {
		get activePanel() {
			return state.activePanel;
		},
		setActivePanel(p: ChimeraPanel) {
			state.activePanel = state.activePanel === p ? 'none' : p;
		},
		get sidecarBaseUrl() {
			return state.sidecarBaseUrl;
		},
		get sidecarStatus() {
			return state.sidecarStatus;
		},
		get loadedModel() {
			return state.loadedModel;
		},
		refresh() {
			state.sidecarBaseUrl = getChimeraBaseUrl();
		},
		setSidecarStatus(s: ShellState['sidecarStatus']) {
			state.sidecarStatus = s;
		},
		setLoadedModel(m: string | null) {
			state.loadedModel = m;
		}
	};
}

export const shellState = createShellState();
