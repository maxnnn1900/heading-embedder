
const { Plugin, SuggestModal, Modal, Notice, MarkdownView } = require('obsidian');

/**
 * Главный класс плагина для вставки заголовков из других заметок.
 */
module.exports = class HeadingEmbedderPlugin extends Plugin {
    async onload() {
        this.addRibbonIcon("link", "Embed Headings", () => {
            const activeFile = this.app.workspace.getActiveFile();
            new FileSuggestModal(this.app, activeFile, async (file) => {
                const content = await this.app.vault.read(file);
                const headings = parseHeadings(content);

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

/**
 * Модальное окно для выбора файла с заголовками.
 */
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

/**
 * Модальное окно для выбора заголовков из выбранного файла.
 */
class HeadingSelectModal extends Modal {
    constructor(app, headings, file, onInsert) {
        super(app);
        this.headings = headings;
        this.file = file;
        this.selected = new Set();
        this.onInsert = onInsert;
        this.checkboxRefs = new Map(); // text => checkbox
        this.levelMap = new Map();     // text => level
        this.containerRefs = new Map(); // text => container
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.addClass("heading-modal");
        contentEl.createEl("h2", { text: "Выберите заголовки:" });

        const listEl = contentEl.createEl("div", { cls: "heading-list" });

        // "Выбрать все"
        const selectAllContainer = listEl.createEl("div", { cls: "heading-entry" });
        selectAllContainer.addClass("heading-line", "select-all");

        const selectAllCheckbox = selectAllContainer.createEl("input", { type: "checkbox" });
        selectAllCheckbox.classList.add("checkbox");
        const selectAllLabel = selectAllContainer.createEl("span", { text: "Выбрать все" });
        selectAllLabel.classList.add("label");

        selectAllLabel.onclick = () => {
            selectAllCheckbox.checked = !selectAllCheckbox.checked;
            selectAllCheckbox.dispatchEvent(new Event("change"));
        };

        selectAllCheckbox.onchange = () => {
            // Снимаем выбор со всех чекбоксов
            this.checkboxRefs.forEach((checkbox, text) => {
                checkbox.checked = false;
                checkbox.disabled = false;
                this.selected.delete(text);
                const cont = this.containerRefs.get(text);
                cont.classList.remove("selected", "disabled");
            });

            if (selectAllCheckbox.checked) {
                // Выбираем только заголовки верхнего уровня
                this.headings.forEach(({ text, top }, index) => {
                    if (top) {
                        const cb = this.checkboxRefs.get(text);
                        cb.checked = true;
                        cb.dispatchEvent(new Event("change"));
                    }
                });
            }
        };

        // Заголовки
        this.headings.forEach(({ level, text }, index) => {
            const container = listEl.createEl("div", { cls: "heading-line" });
            container.style.marginLeft = `${(level - 1) * 20}px`;

            const checkbox = container.createEl("input", { type: "checkbox" });
            checkbox.classList.add("checkbox");

            const label = container.createEl("span", { text });
            label.classList.add("label");

            this.checkboxRefs.set(text, checkbox);
            this.levelMap.set(text, level);
            this.containerRefs.set(text, container);

            label.onclick = () => {
                checkbox.checked = !checkbox.checked;
                checkbox.dispatchEvent(new Event("change"));
            };

            checkbox.onchange = () => {
                if (checkbox.checked) {
                    this.selected.add(text);
                    container.classList.add("selected");
                    // disable all children
                    for (let i = index + 1; i < this.headings.length; i++) {
                        const next = this.headings[i];
                        if (next.level > level) {
                            const cb = this.checkboxRefs.get(next.text);
                            const cont = this.containerRefs.get(next.text);
                            cb.disabled = true;
                            cb.checked = false;
                            cont.classList.add("disabled");
                            cont.classList.remove("selected");
                            this.selected.delete(next.text);
                        } else {
                            break;
                        }
                    }
                } else {
                    this.selected.delete(text);
                    container.classList.remove("selected");
                    // enable all children
                    for (let i = index + 1; i < this.headings.length; i++) {
                        const next = this.headings[i];
                        if (next.level > level) {
                            const cb = this.checkboxRefs.get(next.text);
                            const cont = this.containerRefs.get(next.text);
                            cb.disabled = false;
                            cont.classList.remove("disabled");
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

/**
 * Разбирает содержимое Markdown на заголовки и отмечает верхний уровень.
 * @param {string} content Содержимое файла
 * @returns {Array<{level:number,text:string,top:boolean}>}
 */
function parseHeadings(content) {
    const matches = Array.from(content.matchAll(/^(#{1,6})\s+(.+)/gm));
    const headings = [];
    let minLevel = Infinity;
    for (const m of matches) {
        const level = m[1].length;
        const text = m[2].trim();
        const top = level <= minLevel;
        if (top) minLevel = level;
        headings.push({ level, text, top });
    }
    return headings;
}
