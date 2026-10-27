/** A single SVG primitive (tag + attributes) used to render a lucide-style icon. */
export interface IconElement {
	tag: string;
	attrs: Record<string, string>;
}
