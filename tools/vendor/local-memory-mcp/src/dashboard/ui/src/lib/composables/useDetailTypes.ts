import type { Memory, Task, CodingStandard, Handoff } from "../stores";

export interface HandoffForm {
	from_agent: string;
	to_agent: string;
	task_code: string;
	summary: string;
	context: string;
}

export const INITIAL_HANDOFF_FORM: HandoffForm = {
	from_agent: "",
	to_agent: "",
	task_code: "",
	summary: "",
	context: ""
};

export interface StandardForm {
	name: string;
	context: string;
	version: string;
	language: string;
	stack: string;
	tags: string;
	metadata: string;
	content: string;
	parent_id: string;
}

export const INITIAL_STANDARD_FORM: StandardForm = {
	name: "",
	context: "general",
	version: "1.0.0",
	language: "",
	stack: "",
	tags: "",
	metadata: '{"source":"dashboard"}',
	content: "",
	parent_id: ""
};

export interface DetailState {
	memory: Memory | null;
	task: Task | null;
	standard: CodingStandard | null;
	handoff: Handoff | null;
	editingTitle: boolean;
	editingDescription: boolean;
	editTitle: string;
	editDescription: string;
	newComment: string;
	postingComment: boolean;
	editingCommentId: string | null;
	editCommentText: string;
	savingComment: boolean;
	contentCopied: boolean;
	descCopied: boolean;
	standardEditing: boolean;
	standardForm: StandardForm;
	standardSaving: boolean;
	standardDeleting: boolean;
	standardError: string;
	handoffCreating: boolean;
	handoffUpdating: boolean;
	handoffForm: HandoffForm;
	handoffError: string;
}

export type DetailUpdate = (fn: (state: DetailState) => DetailState) => void;
