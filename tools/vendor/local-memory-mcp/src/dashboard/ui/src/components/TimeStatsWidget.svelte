<script lang="ts">
	import { onMount, onDestroy } from "svelte";
	import {
		Chart,
		BarController,
		BarElement,
		CategoryScale,
		LinearScale,
		Tooltip,
		Legend,
		type ChartConfiguration,
		type ChartDataset
	} from "chart.js";
	import { createTimeStatsHandler } from "../lib/composables/useTimeStats";
	import type { TaskTimePeriodStats } from "../lib/stores";

	type TimeStatsHistoryItem = TaskTimePeriodStats["history"][number];

	// Register required Chart.js components
	Chart.register(BarController, BarElement, CategoryScale, LinearScale, Tooltip, Legend);

	const handler = createTimeStatsHandler();
	const { activePeriod, periodData, history, setActivePeriod, periods, formatTokens, formatDuration } = handler;

	let canvas: HTMLCanvasElement;
	let chart: Chart;

	function initChart() {
		if (!canvas) return;

		const config: ChartConfiguration = {
			type: "bar",
			data: {
				labels: [],
				datasets: [
					{
						label: "Created",
						data: [],
						backgroundColor: "#10b981",
						borderRadius: 4,
						borderSkipped: false,
						barPercentage: 0.6,
						categoryPercentage: 0.8
					},
					{
						label: "Completed",
						data: [],
						backgroundColor: "#6366f1",
						borderRadius: 4,
						borderSkipped: false,
						barPercentage: 0.6,
						categoryPercentage: 0.8
					}
				]
			},
			options: {
				responsive: true,
				maintainAspectRatio: false,
				plugins: {
					legend: { display: false },
					tooltip: {
						backgroundColor: "rgba(15, 23, 42, 0.95)",
						titleFont: { size: 12, weight: "bold" },
						bodyFont: { size: 11 },
						padding: 10,
						cornerRadius: 8,
						displayColors: true,
						borderColor: "rgba(255, 255, 255, 0.1)",
						borderWidth: 1
					}
				},
				scales: {
					x: {
						grid: { display: false },
						ticks: {
							color: "#94a3b8",
							font: { size: 10, family: "monospace" },
							callback: function (val, index) {
								const label = this.getLabelForValue(index as number);
								return label.includes(":00") ? label.split(":")[0] : label.replace("2026-", "").replace("2025-", "");
							}
						}
					},
					y: {
						beginAtZero: true,
						grid: { color: "rgba(148, 163, 184, 0.05)" },
						ticks: {
							color: "#94a3b8",
							font: { size: 9 },
							stepSize: 1,
							precision: 0
						}
					}
				}
			}
		};

		chart = new Chart(canvas, config);
	}

	function updateChart(data: TimeStatsHistoryItem[]) {
		if (!chart) return;
		chart.data.labels = data.map((h) => h.label);
		(chart.data.datasets[0] as ChartDataset<"bar", number[]>).data = data.map((h) => h.created);
		(chart.data.datasets[1] as ChartDataset<"bar", number[]>).data = data.map((h) => h.completed);
		chart.update("none"); // Update without internal animation for immediate feel on tab switch
	}

	onMount(() => {
		// Canvas may not exist yet (it's inside {#if}), so this is a fallback
		if (canvas) initChart();
	});

	onDestroy(() => {
		if (chart) chart.destroy();
	});

	// Init chart as soon as canvas is bound (data may arrive after mount)
	$: if (canvas && !chart) {
		initChart();
		if ($history?.length) updateChart($history);
	}

	$: if (chart && $history) {
		updateChart($history);
	}
</script>

<div class="glass card animate-fade-in">
	<!-- Header + period tabs -->
	<div class="flex items-center justify-between mb-4">
		<div>
			<div
				style="font-size:0.7rem;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:var(--color-primary);"
			>
				Performance
			</div>
			<div style="font-size:0.75rem;color:var(--color-text-muted);">Execution throughput</div>
		</div>
		<div
			class="flex gap-1"
			role="tablist"
			aria-label="Time performance periods"
			style="background:rgba(241,245,249,0.5);padding:3px;border-radius:10px;"
		>
			{#each periods as p, i (`${p.id}-${i}`)}
				<button
					role="tab"
					aria-selected={$activePeriod === p.id}
					tabindex={$activePeriod === p.id ? 0 : -1}
					class="tab-btn"
					class:active={$activePeriod === p.id}
					on:click={() => setActivePeriod(p.id)}
					style="padding:4px 10px;font-size:0.65rem;"
				>
					{p.label}
				</button>
			{/each}
		</div>
	</div>

	<!-- Metrics grid -->
	<div class="metrics-grid">
		<div
			style="background:rgba(99,102,241,0.08);border:1px solid rgba(99,102,241,0.1);border-radius:12px;padding:12px;"
		>
			<div
				style="font-size:0.6rem;color:#6366f1;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:4px;"
			>
				Done
			</div>
			<div style="font-size:1.5rem;font-weight:900;color:var(--color-text);line-height:1;letter-spacing:-0.03em;">
				{$periodData?.completed ?? "—"}
			</div>
		</div>
		<div
			style="background:rgba(16,185,129,0.08);border:1px solid rgba(16,185,129,0.1);border-radius:12px;padding:12px;"
		>
			<div
				style="font-size:0.6rem;color:#10b981;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:4px;"
			>
				Added
			</div>
			<div style="font-size:1.5rem;font-weight:900;color:var(--color-text);line-height:1;letter-spacing:-0.03em;">
				{$periodData?.added ?? "—"}
			</div>
		</div>
		<div
			style="background:rgba(56,189,248,0.08);border:1px solid rgba(56,189,248,0.1);border-radius:12px;padding:12px;"
		>
			<div
				style="font-size:0.6rem;color:#0ea5e9;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:4px;"
			>
				Tokens
			</div>
			<div style="font-size:1.5rem;font-weight:900;color:var(--color-text);line-height:1;letter-spacing:-0.03em;">
				{$periodData?.tokens ? formatTokens($periodData.tokens) : "—"}
			</div>
		</div>
		<div
			style="background:rgba(245,158,11,0.08);border:1px solid rgba(245,158,11,0.1);border-radius:12px;padding:12px;"
		>
			<div
				style="font-size:0.6rem;color:#f59e0b;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:4px;"
			>
				Velocity
			</div>
			<div style="font-size:1.5rem;font-weight:900;color:var(--color-text);line-height:1;letter-spacing:-0.03em;">
				{$periodData?.avgDuration ? formatDuration($periodData.avgDuration) : "—"}
			</div>
		</div>
	</div>

	<!-- Chart.js Visualization -->
	<div class="pt-4 border-t border-dashed" style="border-color:var(--color-border);">
		{#if $periodData?.history && $periodData.history.length > 0}
			<div class="flex items-center justify-between mb-4">
				<div
					style="font-size:0.65rem;font-weight:700;color:var(--color-text-muted);text-transform:uppercase;letter-spacing:0.1em;"
				>
					Trend Line
				</div>
				<div class="flex gap-3">
					<div class="flex items-center gap-1.5">
						<div style="width:8px;height:8px;border-radius:2px;background:#10b981;"></div>
						<span style="font-size:0.6rem;font-weight:600;color:var(--color-text-muted);">Added</span>
					</div>
					<div class="flex items-center gap-1.5">
						<div style="width:8px;height:8px;border-radius:2px;background:#6366f1;"></div>
						<span style="font-size:0.6rem;font-weight:600;color:var(--color-text-muted);">Done</span>
					</div>
				</div>
			</div>

			<div style="height:120px;position:relative;width:100%;">
				<canvas bind:this={canvas}></canvas>
			</div>
		{:else}
			<div class="compact-empty">No trend data for this period</div>
		{/if}
	</div>
</div>

<style>
	.metrics-grid {
		display: grid;
		grid-template-columns: repeat(2, 1fr);
		gap: 12px;
		margin-bottom: 16px;
	}

	.compact-empty {
		min-height: 56px;
		display: flex;
		align-items: center;
		justify-content: center;
		color: var(--color-text-muted);
		font-size: 0.75rem;
	}

	@media (max-width: 640px) {
		.metrics-grid {
			grid-template-columns: 1fr;
		}
	}
</style>
