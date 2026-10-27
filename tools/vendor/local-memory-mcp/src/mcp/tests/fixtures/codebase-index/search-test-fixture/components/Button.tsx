import React from "react";

export interface ButtonProps {
	label: string;
	variant?: "primary" | "secondary" | "danger";
	disabled?: boolean;
	onClick: () => void;
}

export function Button({ label, variant = "primary", disabled = false, onClick }: ButtonProps) {
	const baseClass = "btn";
	const variantClass = `btn-${variant}`;
	const disabledClass = disabled ? "btn-disabled" : "";

	return (
		<button
			className={[baseClass, variantClass, disabledClass].filter(Boolean).join(" ")}
			disabled={disabled}
			onClick={onClick}
		>
			{label}
		</button>
	);
}

export function SubmitButton({ onClick }: { onClick: () => void }) {
	return <Button label="Submit" variant="primary" onClick={onClick} />;
}

export function DangerButton({ label, onClick }: { label: string; onClick: () => void }) {
	return <Button label={label} variant="danger" onClick={onClick} />;
}
