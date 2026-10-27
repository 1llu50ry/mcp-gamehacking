<script lang="ts">
	import { marked } from "marked";
	import type { Token } from "marked";

	export let content: string = "";

	$: tokens = marked.lexer(content);

	function isLink(token: Token): token is Extract<Token, { type: "link" }> {
		return token.type === "link";
	}

	function isStrong(token: Token): token is Extract<Token, { type: "strong" }> {
		return token.type === "strong";
	}

	function isEm(token: Token): token is Extract<Token, { type: "em" }> {
		return token.type === "em";
	}

	function isCodespan(token: Token): token is Extract<Token, { type: "codespan" }> {
		return token.type === "codespan";
	}

	function isList(token: Token): token is Extract<Token, { type: "list" }> {
		return token.type === "list";
	}

	function isCode(token: Token): token is Extract<Token, { type: "code" }> {
		return token.type === "code";
	}

	function isTable(token: Token): token is Extract<Token, { type: "table" }> {
		return token.type === "table";
	}
</script>

<div class="markdown-body">
	{#each tokens as token, tokenIndex (`${token.type}-${tokenIndex}`)}
		{#if token.type === "heading"}
			{#if token.depth === 1}
				<h1>{token.text}</h1>
			{:else if token.depth === 2}
				<h2>{token.text}</h2>
			{:else if token.depth === 3}
				<h3>{token.text}</h3>
			{:else if token.depth === 4}
				<h4>{token.text}</h4>
			{:else if token.depth === 5}
				<h5>{token.text}</h5>
			{:else}
				<h6>{token.text}</h6>
			{/if}
		{:else if token.type === "paragraph"}
			<p>
				{#each token.tokens || [] as inline, inlineIndex (`${inline.type}-${inlineIndex}`)}
					{#if inline.type === "text"}
						{inline.text}
					{:else if isStrong(inline)}
						<strong>{inline.text}</strong>
					{:else if isEm(inline)}
						<em>{inline.text}</em>
					{:else if isCodespan(inline)}
						<code>{inline.text}</code>
					{:else if isLink(inline)}
						<a href={inline.href} title={inline.title}>{inline.text}</a>
					{:else}
						{inline.raw}
					{/if}
				{/each}
			</p>
		{:else if isList(token)}
			{#if token.ordered}
				<ol start={typeof token.start === "number" ? token.start : undefined}>
					{#each token.items as item, itemIndex (`ordered-${itemIndex}`)}
						<li>
							{#each item.tokens || [] as itemToken, itemTokenIndex (`${itemToken.type}-${itemTokenIndex}`)}
								{#if itemToken.type === "text"}
									{itemToken.text}
								{:else}
									<!-- Recursive handling would be better but keeping it simple for now -->
									{itemToken.raw}
								{/if}
							{/each}
						</li>
					{/each}
				</ol>
			{:else}
				<ul>
					{#each token.items as item, itemIndex (`unordered-${itemIndex}`)}
						<li>
							{#each item.tokens || [] as itemToken, itemTokenIndex (`${itemToken.type}-${itemTokenIndex}`)}
								{#if itemToken.type === "text"}
									{itemToken.text}
								{:else}
									{itemToken.raw}
								{/if}
							{/each}
						</li>
					{/each}
				</ul>
			{/if}
		{:else if isCode(token)}
			<pre><code>{token.text}</code></pre>
		{:else if isTable(token)}
			<table>
				<thead>
					<tr>
						{#each token.header as header, headerIndex (`${header.text}-${headerIndex}`)}
							<th>{header.text}</th>
						{/each}
					</tr>
				</thead>
				<tbody>
					{#each token.rows as row, rowIndex (`row-${rowIndex}`)}
						<tr>
							{#each row as cell, cellIndex (`${cell.text}-${cellIndex}`)}
								<td>{cell.text}</td>
							{/each}
						</tr>
					{/each}
				</tbody>
			</table>
		{:else if token.type === "space"}
			<br />
		{:else if token.type === "hr"}
			<hr />
		{:else if token.type === "blockquote"}
			<blockquote>{token.text}</blockquote>
		{:else}
			{token.raw}
		{/if}
	{/each}
</div>

<style>
	.markdown-body {
		line-height: 1.6;
	}
	.markdown-body p {
		margin-bottom: 1em;
	}
	.markdown-body code {
		background-color: rgba(0, 0, 0, 0.05);
		padding: 0.2em 0.4em;
		border-radius: 3px;
		font-family: monospace;
	}
	.markdown-body pre {
		background-color: rgba(0, 0, 0, 0.05);
		padding: 1em;
		overflow: auto;
		border-radius: 5px;
	}
	.markdown-body table {
		border-collapse: collapse;
		width: 100%;
		margin-bottom: 1em;
	}
	.markdown-body th,
	.markdown-body td {
		border: 1px solid #ddd;
		padding: 8px;
		text-align: left;
	}
	.markdown-body blockquote {
		border-left: 4px solid #ddd;
		padding-left: 1em;
		color: #666;
		margin: 1em 0;
	}
</style>
