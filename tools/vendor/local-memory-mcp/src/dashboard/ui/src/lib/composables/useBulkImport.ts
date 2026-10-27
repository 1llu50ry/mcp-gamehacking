import { writable, type Writable } from "svelte/store";
import { api } from "../api";
import { alertSuccess } from "../confirm";

// ─── Types ──────────────────────────────────────────────────────────────────

export type ImportTarget = "memories" | "tasks";

export interface CSVRow {
	[key: string]: string | number | boolean | null | undefined;
}

export interface CSVResult {
	headers: string[];
	rows: CSVRow[];
}

export const TEMPLATES: Record<ImportTarget, string> = {
	memories: "title,type,content,importance\nExample Memory,fact,This is an example memory content,3",
	tasks:
		"task_code,title,phase,description,status,priority\nTSK-001,Example Task,Phase 1,Example task description,backlog,3"
};

// ─── Composable ──────────────────────────────────────────────────────────────

export function createBulkImport(options: {
	repo: string;
	importTarget: ImportTarget;
	onSuccess?: () => void;
	onClose?: () => void;
}) {
	const file: Writable<File | null> = writable(null);
	const csvData: Writable<CSVRow[]> = writable([]);
	const headers: Writable<string[]> = writable([]);
	const fileName: Writable<string> = writable("");
	const errorMsg: Writable<string> = writable("");
	const isSubmitting: Writable<boolean> = writable(false);
	const isOpen: Writable<boolean> = writable(false);

	function reset() {
		file.set(null);
		csvData.set([]);
		headers.set([]);
		fileName.set("");
		errorMsg.set("");
		isSubmitting.set(false);
	}

	function close() {
		isOpen.set(false);
		reset();
		if (options.onClose) options.onClose();
	}

	function open() {
		isOpen.set(true);
	}

	function parseCSV(text: string): CSVResult {
		const lines = text.split(/\r?\n/).filter((line) => line.trim() !== "");
		if (lines.length === 0) return { headers: [], rows: [] };

		const splitLine = (line: string) => {
			const result = [];
			let cur = "";
			let inQuotes = false;
			for (let i = 0; i < line.length; i++) {
				const char = line[i];
				if (char === '"' && line[i + 1] === '"') {
					cur += '"';
					i++;
				} else if (char === '"') inQuotes = !inQuotes;
				else if (char === "," && !inQuotes) {
					result.push(cur.trim());
					cur = "";
				} else cur += char;
			}
			result.push(cur.trim());
			return result;
		};

		const rawHeaders = splitLine(lines[0]);
		const filteredHeaders = rawHeaders.filter((h) => h !== "");

		const rows = lines
			.slice(1)
			.map(splitLine)
			.map((row) => {
				const obj: CSVRow = {};
				filteredHeaders.forEach((h, i) => {
					const key = h.toLowerCase().replace(/[^a-z0-9_]/g, "_");
					obj[key] = row[i];
				});
				return obj;
			});

		return { headers: filteredHeaders, rows };
	}

	function processFile(selectedFile: File) {
		errorMsg.set("");
		if (!selectedFile.name.endsWith(".csv")) {
			errorMsg.set("Please select a valid .csv file.");
			return;
		}

		file.set(selectedFile);
		fileName.set(selectedFile.name);

		const reader = new FileReader();
		reader.onload = (re) => {
			const text = re.target?.result as string;
			const parsed = parseCSV(text);
			headers.set(parsed.headers);
			csvData.set(parsed.rows);
			if (parsed.rows.length === 0) {
				errorMsg.set("CSV file appears to be empty or missing headers.");
			}
		};
		reader.readAsText(selectedFile);
	}

	function handleFileSelect(e: Event) {
		const target = e.target as HTMLInputElement;
		const selectedFile = target.files?.[0];
		if (selectedFile) processFile(selectedFile);
	}

	function handleFileDrop(e: DragEvent) {
		e.preventDefault();
		const droppedFile = e.dataTransfer?.files?.[0];
		if (droppedFile) processFile(droppedFile);
	}

	function downloadExample() {
		const csvContent = TEMPLATES[options.importTarget];
		const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
		const url = URL.createObjectURL(blob);
		const link = document.createElement("a");
		link.setAttribute("href", url);
		link.setAttribute("download", `example_${options.importTarget}.csv`);
		link.style.visibility = "hidden";
		document.body.appendChild(link);
		link.click();
		document.body.removeChild(link);
	}

	async function handleImport() {
		let currentCsvData: CSVRow[] = [];
		csvData.subscribe((v) => (currentCsvData = v))();

		errorMsg.set("");
		if (currentCsvData.length === 0) {
			errorMsg.set("No data to import.");
			return;
		}

		isSubmitting.set(true);
		try {
			let count = 0;
			if (options.importTarget === "memories") {
				const res = await api.bulkImportMemories(options.repo, currentCsvData);
				count = res.count;
			} else {
				const res = await api.bulkImportTasks(options.repo, currentCsvData);
				count = res.count;
			}

			alertSuccess(`Imported ${count} ${options.importTarget} successfully.`);
			if (options.onSuccess) options.onSuccess();
			close();
		} catch (err) {
			errorMsg.set(err instanceof Error ? err.message : "Import failed");
		} finally {
			isSubmitting.set(false);
		}
	}

	return {
		// State
		file,
		csvData,
		headers,
		fileName,
		errorMsg,
		isSubmitting,
		isOpen,
		// Actions
		open,
		close,
		handleFileSelect,
		handleFileDrop,
		downloadExample,
		handleImport,
		setFile: (val: File | null) => file.set(val),
		setCsvData: (val: CSVRow[]) => csvData.set(val)
	};
}
