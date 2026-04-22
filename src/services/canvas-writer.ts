import type AgentClientPlugin from "../plugin";
import { TFile, Notice } from "obsidian";
import { getLogger, Logger } from "../utils/logger";

interface CanvasTextNode {
	id: string;
	type: "text";
	text: string;
	x: number;
	y: number;
	width: number;
	height: number;
	color?: string;
}

interface CanvasEdge {
	id: string;
	fromNode: string;
	toNode: string;
	fromSide?: "top" | "right" | "bottom" | "left";
	toSide?: "top" | "right" | "bottom" | "left";
}

interface CanvasData {
	nodes: CanvasTextNode[];
	edges: CanvasEdge[];
}

export interface NewCard {
	text: string;
	color?: string;
}

export interface WriteResult {
	file: TFile;
	nodeIds: string[];
}

const CARD_WIDTH = 400;
const CARD_HEIGHT = 200;
const COL_GAP = 50;
const ROW_GAP = 50;
const COLS = 2;
const DEFAULT_CANVAS_NAME = "AI Cards.canvas";

export class CanvasWriter {
	private logger: Logger;

	constructor(private plugin: AgentClientPlugin) {
		this.logger = getLogger();
	}

	async saveCards(cards: NewCard[]): Promise<WriteResult | null> {
		if (cards.length === 0) return null;

		const targetFile = await this.resolveTargetCanvas();
		const existing = await this.readCanvas(targetFile);

		const origin = computeAppendOrigin(existing.nodes);
		const newNodes: CanvasTextNode[] = cards.map((card, idx) => ({
			id: generateNodeId(),
			type: "text",
			text: card.text,
			x: origin.x + (idx % COLS) * (CARD_WIDTH + COL_GAP),
			y: origin.y + Math.floor(idx / COLS) * (CARD_HEIGHT + ROW_GAP),
			width: CARD_WIDTH,
			height: CARD_HEIGHT,
			...(card.color ? { color: card.color } : {}),
		}));

		const updated: CanvasData = {
			nodes: [...existing.nodes, ...newNodes],
			edges: existing.edges,
		};

		await this.plugin.app.vault.modify(
			targetFile,
			JSON.stringify(updated, null, 2),
		);

		new Notice(
			`Saved ${cards.length} card${cards.length === 1 ? "" : "s"} to ${targetFile.name}`,
		);
		this.logger.log(
			`[CanvasWriter] Appended ${newNodes.length} nodes to ${targetFile.path}`,
		);

		return { file: targetFile, nodeIds: newNodes.map((n) => n.id) };
	}

	async openCanvas(file: TFile): Promise<void> {
		const leaf = this.plugin.app.workspace.getLeaf(false);
		await leaf.openFile(file);
	}

	private async resolveTargetCanvas(): Promise<TFile> {
		const active = this.plugin.app.workspace.getActiveFile();
		if (active && active.extension === "canvas") {
			return active;
		}

		const fallbackPath = this.defaultCanvasPath();
		const existing =
			this.plugin.app.vault.getAbstractFileByPath(fallbackPath);
		if (existing instanceof TFile) {
			return existing;
		}

		await this.ensureParentFolder(fallbackPath);
		const emptyCanvas: CanvasData = { nodes: [], edges: [] };
		return await this.plugin.app.vault.create(
			fallbackPath,
			JSON.stringify(emptyCanvas, null, 2),
		);
	}

	private async ensureParentFolder(filePath: string): Promise<void> {
		const lastSlash = filePath.lastIndexOf("/");
		if (lastSlash <= 0) return;
		const folderPath = filePath.slice(0, lastSlash);
		if (this.plugin.app.vault.getAbstractFileByPath(folderPath)) return;
		await this.plugin.app.vault.createFolder(folderPath);
	}

	private defaultCanvasPath(): string {
		const folder = this.plugin.settings.exportSettings?.defaultFolder;
		if (folder && folder.trim().length > 0) {
			return `${folder.replace(/\/+$/, "")}/${DEFAULT_CANVAS_NAME}`;
		}
		return DEFAULT_CANVAS_NAME;
	}

	private async readCanvas(file: TFile): Promise<CanvasData> {
		try {
			const raw = await this.plugin.app.vault.read(file);
			if (!raw.trim()) return { nodes: [], edges: [] };
			const parsed = JSON.parse(raw) as Partial<CanvasData>;
			return {
				nodes: Array.isArray(parsed.nodes) ? parsed.nodes : [],
				edges: Array.isArray(parsed.edges) ? parsed.edges : [],
			};
		} catch (err) {
			this.logger.warn(
				`[CanvasWriter] Failed to parse ${file.path}, treating as empty`,
				err,
			);
			return { nodes: [], edges: [] };
		}
	}
}

function computeAppendOrigin(nodes: CanvasTextNode[]): {
	x: number;
	y: number;
} {
	if (nodes.length === 0) return { x: 0, y: 0 };
	let maxY = -Infinity;
	let minX = Infinity;
	for (const n of nodes) {
		const bottom = n.y + (n.height ?? CARD_HEIGHT);
		if (bottom > maxY) maxY = bottom;
		if (n.x < minX) minX = n.x;
	}
	return {
		x: minX === Infinity ? 0 : minX,
		y: maxY === -Infinity ? 0 : maxY + ROW_GAP,
	};
}

function generateNodeId(): string {
	const bytes = new Uint8Array(8);
	crypto.getRandomValues(bytes);
	return Array.from(bytes)
		.map((b) => b.toString(16).padStart(2, "0"))
		.join("");
}
