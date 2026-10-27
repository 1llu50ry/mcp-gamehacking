import Swal from "sweetalert2";

export async function confirmDelete(title: string): Promise<boolean> {
	const result = await Swal.fire({
		title: "Konfirmasi Hapus",
		text: title,
		icon: "warning",
		showCancelButton: true,
		confirmButtonColor: "#ef4444",
		cancelButtonColor: "#64748b",
		confirmButtonText: "Ya, Hapus",
		cancelButtonText: "Batal",
		reverseButtons: true,
		background: "var(--color-surface, #fff)",
		color: "var(--color-text, #0f172a)"
	});
	return result.isConfirmed;
}

export async function alertError(message: string) {
	await Swal.fire({
		icon: "error",
		title: "Error",
		text: message,
		confirmButtonColor: "#0ea5e9",
		background: "var(--color-surface, #fff)",
		color: "var(--color-text, #0f172a)"
	});
}

export async function alertSuccess(message: string) {
	await Swal.fire({
		icon: "success",
		title: "Berhasil",
		text: message,
		timer: 2000,
		showConfirmButton: false,
		background: "var(--color-surface, #fff)",
		color: "var(--color-text, #0f172a)"
	});
}

export async function confirmAction(title: string, text: string): Promise<boolean> {
	const result = await Swal.fire({
		title,
		text,
		icon: "question",
		showCancelButton: true,
		confirmButtonColor: "#0ea5e9",
		cancelButtonColor: "#64748b",
		confirmButtonText: "Ya",
		cancelButtonText: "Batal",
		reverseButtons: true,
		background: "var(--color-surface, #fff)",
		color: "var(--color-text, #0f172a)"
	});
	return result.isConfirmed;
}
