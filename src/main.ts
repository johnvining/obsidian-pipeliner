import { App, Menu, MenuItem, Modal, Notice, Plugin, Setting, TAbstractFile, TFile, TFolder } from "obsidian";

type Outcome = "added" | "filled" | "appended" | "skipped";
type AddItem = (cb: (item: MenuItem) => void) => void;

// Minimal slice of Notebook Navigator's public API (src/api/public/notebook-navigator.d.ts).
interface NotebookNavigatorAPI {
	menus: {
		registerFileMenu(cb: (ctx: { addItem: AddItem; selection: { files: readonly TFile[] } }) => void): () => void;
		registerFolderMenu(cb: (ctx: { addItem: AddItem; folder: TFolder }) => void): () => void;
	};
}

export default class PipelinerPlugin extends Plugin {
	async onload() {
		// Fires when right-clicking a multi-selection in the file explorer.
		this.registerEvent(
			this.app.workspace.on("files-menu", (menu: Menu, files: TAbstractFile[]) => {
				this.addMenuItems(sectioned(menu), collectNotes(files));
			})
		);

		// Fires when right-clicking a single file or folder.
		this.registerEvent(
			this.app.workspace.on("file-menu", (menu: Menu, file: TAbstractFile) => {
				this.addMenuItems(sectioned(menu), collectNotes([file]));
			})
		);

		// Notebook Navigator builds its own context menus and doesn't fire the events above.
		this.app.workspace.onLayoutReady(() => this.registerNotebookNavigatorMenus());
	}

	private registerNotebookNavigatorMenus() {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const nn = (this.app as any).plugins?.plugins?.["notebook-navigator"]?.api as NotebookNavigatorAPI | undefined;
		if (!nn?.menus) return;

		const disposeFile = nn.menus.registerFileMenu(({ addItem, selection }) => {
			this.addMenuItems(addItem, collectNotes([...selection.files]));
		});
		const disposeFolder = nn.menus.registerFolderMenu(({ addItem, folder }) => {
			this.addMenuItems(addItem, collectNotes([folder]));
		});
		this.register(() => {
			disposeFile();
			disposeFolder();
		});
	}

	private addMenuItems(addItem: AddItem, notes: TFile[]) {
		if (notes.length === 0) return;
		const label = notes.length === 1 ? "note" : `${notes.length} notes`;

		addItem((item) =>
			item
				.setTitle(`Add blank property to ${label}`)
				.setIcon("list-plus")
				.onClick(() => {
					new PropertyModal(this.app, false, (key) => this.applyProperty(notes, key, null)).open();
				})
		);

		addItem((item) =>
			item
				.setTitle(`Add property with value to ${label}`)
				.setIcon("list-plus")
				.onClick(() => {
					new PropertyModal(this.app, true, (key, value) => this.applyProperty(notes, key, value)).open();
				})
		);
	}

	private async applyProperty(notes: TFile[], key: string, value: string | null) {
		const counts: Record<Outcome, number> = { added: 0, filled: 0, appended: 0, skipped: 0 };
		let failed = 0;

		for (const note of notes) {
			try {
				let outcome: Outcome = "skipped";
				await this.app.fileManager.processFrontMatter(note, (fm) => {
					outcome = setWithoutOverwrite(fm, key, value);
				});
				counts[outcome]++;
			} catch (e) {
				console.error(`Pipeliner: failed to update ${note.path}`, e);
				failed++;
			}
		}

		const parts = [`added to ${counts.added}`];
		if (counts.filled) parts.push(`filled empty in ${counts.filled}`);
		if (counts.appended) parts.push(`appended to list in ${counts.appended}`);
		if (counts.skipped) parts.push(`skipped ${counts.skipped} (already set)`);
		if (failed) parts.push(`failed ${failed} (see console)`);
		new Notice(`"${key}": ${parts.join(", ")}`);
	}
}

/**
 * Sets `key` on the frontmatter object without clobbering existing data:
 * - missing → set it
 * - present but empty → fill it (only when a value was given)
 * - present as a list → append the value if not already there
 * - otherwise → leave it alone
 */
function setWithoutOverwrite(fm: Record<string, unknown>, key: string, value: string | null): Outcome {
	if (!(key in fm)) {
		fm[key] = value;
		return "added";
	}
	if (value === null) return "skipped";

	const existing = fm[key];
	if (isEmpty(existing)) {
		fm[key] = value;
		return "filled";
	}
	if (Array.isArray(existing)) {
		if (existing.includes(value)) return "skipped";
		existing.push(value);
		return "appended";
	}
	return "skipped";
}

function isEmpty(v: unknown): boolean {
	return v === null || v === undefined || v === "" || (Array.isArray(v) && v.length === 0);
}

/** Adds items to the "action" section of a core Obsidian menu. */
function sectioned(menu: Menu): AddItem {
	return (cb) => menu.addItem((item) => cb(item.setSection("action")));
}

/** Expands folders and filters down to markdown notes. */
function collectNotes(files: TAbstractFile[]): TFile[] {
	const notes = new Map<string, TFile>();
	const visit = (f: TAbstractFile) => {
		if (f instanceof TFile) {
			if (f.extension === "md") notes.set(f.path, f);
		} else if (f instanceof TFolder) {
			f.children.forEach(visit);
		}
	};
	files.forEach(visit);
	return [...notes.values()];
}

class PropertyModal extends Modal {
	private key = "";
	private value = "";

	constructor(
		app: App,
		private withValue: boolean,
		private onSubmit: (key: string, value: string) => void
	) {
		super(app);
	}

	onOpen() {
		const { contentEl } = this;
		this.titleEl.setText(this.withValue ? "Add property with value" : "Add blank property");

		new Setting(contentEl).setName("Property name").addText((text) => {
			text.onChange((v) => (this.key = v));
			text.inputEl.addEventListener("keydown", this.submitOnEnter);
			window.setTimeout(() => text.inputEl.focus(), 0);
		});

		if (this.withValue) {
			new Setting(contentEl).setName("Value").addText((text) => {
				text.onChange((v) => (this.value = v));
				text.inputEl.addEventListener("keydown", this.submitOnEnter);
			});
		}

		new Setting(contentEl).addButton((btn) =>
			btn
				.setButtonText("Apply")
				.setCta()
				.onClick(() => this.submit())
		);
	}

	private submitOnEnter = (e: KeyboardEvent) => {
		if (e.key === "Enter") {
			e.preventDefault();
			this.submit();
		}
	};

	private submit() {
		const key = this.key.trim();
		if (!key) {
			new Notice("Property name is required");
			return;
		}
		this.close();
		this.onSubmit(key, this.value.trim());
	}

	onClose() {
		this.contentEl.empty();
	}
}
