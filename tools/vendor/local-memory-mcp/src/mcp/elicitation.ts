export type ElicitationAction = "accept" | "decline" | "cancel";

export type FormElicitationRequest = {
	mode?: "form";
	message: string;
	requestedSchema: {
		type: "object";
		properties: Record<string, unknown>;
		required?: string[];
	};
};

export type UrlElicitationRequest = {
	mode: "url";
	message: string;
	url: string;
	elicitationId: string;
};

export type ElicitationCreateParams = FormElicitationRequest | UrlElicitationRequest;

export type ElicitationCreateResult = {
	action: ElicitationAction;
	content?: Record<string, unknown>;
};

export type ElicitationRequestHandler = (params: ElicitationCreateParams) => Promise<ElicitationCreateResult>;

export function extractAcceptedElicitationContent(
	result: ElicitationCreateResult | null | undefined
): Record<string, unknown> {
	if (result?.action === "accept" && result.content && typeof result.content === "object") {
		return result.content;
	}

	if (result?.action === "decline") {
		throw new Error("User declined the elicitation request");
	}

	if (result?.action === "cancel") {
		throw new Error("User canceled the elicitation request");
	}

	throw new Error("Elicitation did not return accepted content");
}
