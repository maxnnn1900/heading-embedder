
const { Plugin, SuggestModal, Modal, Notice, MarkdownView } = require('obsidian');

// Главный класс плагина
module.exports = class HeadingEmbedderPlugin extends Plugin {
    async onload() {
        this.addRibbonIcon("link", "Embed Headings", () => {
            const activeFile = this.app.workspace.getActiveFile();
            new FileSuggestModal(this.app, activeFile, async (file) => {
                const content = await this.app.vault.read(file);
                const headings = Array.from(content.matchAll(/^(#{1,6})\s+(.+)/gm)).map(m => ({
                    level: m[1].length,
                    text: m[2].trim()
                }));

                if (headings.length === 0) {
                    new Notice("Заголовки не найдены.");
                    return;
                }

                new HeadingSelectModal(this.app, headings, file, (selectedHeadings) => {
                    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
                    if (!view) {
                        new Notice("Нет открытой Markdown заметки.");
                        return;
                    }

                    const editor = view.editor;
                    const embeds = selectedHeadings.map(h => `![[${file.basename}#${h}]]`).join("\n");
                    editor.replaceSelection(embeds + "\n");
                }).open();
            }).open();
        });

        new Notice("Heading Embedder загружен");
    }
};

// Модальное окно для выбора файла с заголовками
class FileSuggestModal extends SuggestModal {
    constructor(app, skipFile, onChoose) {
        super(app);
        this.skipFile = skipFile;
        this.onChoose = onChoose;
    }

    getSuggestions(query) {
        return this.app.vault.getMarkdownFiles().filter(file =>
            file !== this.skipFile &&
            file.path.toLowerCase().includes(query.toLowerCase())
        );
    }

    renderSuggestion(file, el) {
        el.setText(file.path);
    }

    onChooseSuggestion(file) {
        this.onChoose(file);
    }
}

// Модальное окно для выбора заголовков
class HeadingSelectModal extends Modal {
    constructor(app, headings, file, onInsert) {
        super(app);
        this.headings = headings;
        this.file = file;
        this.selected = new Set();
        this.onInsert = onInsert;
        this.checkboxRefs = new Map(); // text => checkbox
        this.levelMap = new Map();     // text => level
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.addClass("heading-modal");
        contentEl.createEl("h2", { text: "Выберите заголовки:" });

        // "Выбрать все"
        const selectAllContainer = contentEl.createEl("div", { cls: "heading-entry" });
        selectAllContainer.addClass("heading-line");

        const selectAllCheckbox = selectAllContainer.createEl("input", { type: "checkbox" });
        selectAllCheckbox.classList.add("checkbox");
        const selectAllLabel = selectAllContainer.createEl("span", { text: "Выбрать все" });
        selectAllLabel.classList.add("label");

        selectAllLabel.onclick = () => {
            selectAllCheckbox.checked = !selectAllCheckbox.checked;
            selectAllCheckbox.dispatchEvent(new Event("change"));
        };

        selectAllCheckbox.onchange = () => {
            this.checkboxRefs.forEach((checkbox, text) => {
                checkbox.checked = selectAllCheckbox.checked;
                checkbox.disabled = false;
                if (checkbox.checked) this.selected.add(text);
                else this.selected.delete(text);
            });
        };

        // Заголовки
        this.headings.forEach(({ level, text }, index) => {
            const container = contentEl.createEl("div", { cls: "heading-line" });
            container.style.marginLeft = `${(level - 1) * 20}px`;

            const checkbox = container.createEl("input", { type: "checkbox" });
            checkbox.classList.add("checkbox");

            const label = container.createEl("span", { text });
            label.classList.add("label");

            this.checkboxRefs.set(text, checkbox);
            this.levelMap.set(text, level);

            label.onclick = () => {
                checkbox.checked = !checkbox.checked;
                checkbox.dispatchEvent(new Event("change"));
            };

            checkbox.onchange = () => {
                if (checkbox.checked) {
                    this.selected.add(text);
                    // disable all children
                    for (let i = index + 1; i < this.headings.length; i++) {
                        const next = this.headings[i];
                        if (next.level > level) {
                            const cb = this.checkboxRefs.get(next.text);
                            cb.disabled = true;
                            cb.checked = false;
                            this.selected.delete(next.text);
                        } else {
                            break;
                        }
                    }
                } else {
                    this.selected.delete(text);
                    // enable all children
                    for (let i = index + 1; i < this.headings.length; i++) {
                        const next = this.headings[i];
                        if (next.level > level) {
                            const cb = this.checkboxRefs.get(next.text);
                            cb.disabled = false;
                        } else {
                            break;
                        }
                    }
                }
            };
        });

        const button = contentEl.createEl("button", { text: "Добавить" });
        button.classList.add("add-button");
        button.onclick = () => {
            this.onInsert(Array.from(this.selected));
            this.close();
        };
    }

    onClose() {
        this.contentEl.removeClass("heading-modal");
        this.contentEl.empty();
    }
}
