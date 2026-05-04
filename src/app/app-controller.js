import { getElements } from "./dom.js";
import { DAILY_PROMPTS, normalizeSections } from "./prompts.js";
import { renderApp, renderChrome, renderEditor, renderSaveStatus, isDirty } from "./render.js";
import { createInitialState } from "./state.js";
import {
  cloneEntry,
  createBlankDraft,
  getBasename,
  getCalendarMonthKey,
  getSelectedMonthKey,
  getSelectedWeekKey,
  getSelectedYearKey,
  shortenPath,
  snapshotEntry
} from "./utils.js";
import { getEditorView } from "./view-state.js";

export class BillbookApp {
  constructor(gateway) {
    this.gateway = gateway;
    this.state = createInitialState();
    this.elements = getElements();
    this.internalWriteGuards = new Map();
    this.dirtySyncFrame = 0;
    this.sectionResizeFrame = 0;
    this.sectionLoadToken = 0;
    this.pendingSectionLoads = new Map();
  }

  showToast(message) {
    clearTimeout(this.state.folderToastTimeoutId);
    this.elements.folderToast.textContent = message;
    this.elements.folderToast.classList.remove("is-hidden");
    this.state.folderToastTimeoutId = window.setTimeout(() => {
      this.elements.folderToast.classList.add("is-hidden");
    }, 2600);
  }

  buildFinanceErrorText(message) {
    return [
      "Finance Snapshot Error",
      message || "Billbook could not generate the finance snapshot for this entry.",
      "",
      "You can reconnect or reconfigure SimpleFIN from the sidebar menu, or replace this text manually."
    ].join("\n");
  }

  buildSleepUnavailableText() {
    return "Duration: unavailable";
  }

  extractNetWorthBlock(financeText) {
    const normalized = String(financeText || "").replace(/\r\n/g, "\n").trim();

    if (!normalized) {
      return null;
    }

    const match = normalized.match(
      /^(?:###\s+)?Net Worth\s*\n([^\n]+)\n(As of [^\n]+)(?:\n|$)/im
    );

    if (!match) {
      return null;
    }

    return {
      block: `Net Worth\n${match[1].trim()}\n${match[2].trim()}`,
      amountLine: match[1].trim(),
      asOfLine: match[2].trim()
    };
  }

  replaceNetWorthBlock(financeText, replacementBlock) {
    const normalized = String(financeText || "").replace(/\r\n/g, "\n").trim();

    if (!normalized || !replacementBlock) {
      return normalized;
    }

    return normalized.replace(
      /^(?:###\s+)?Net Worth\s*\n[^\n]+\nAs of [^\n]+/im,
      replacementBlock.trim()
    );
  }

  async findMonthlyNetWorthSnapshot(dateString) {
    const monthKey = getCalendarMonthKey(dateString);

    if (!monthKey) {
      return null;
    }

    const monthEntries = this.state.entries
      .filter((entry) => entry?.filePath && getCalendarMonthKey(entry.date) === monthKey)
      .sort((left, right) => {
        if (left.date !== right.date) {
          return left.date.localeCompare(right.date);
        }

        return left.createdAt.localeCompare(right.createdAt);
      });

    for (const monthEntry of monthEntries) {
      if (monthEntry?.netWorthSnapshot?.block) {
        return monthEntry.netWorthSnapshot;
      }
    }

    return null;
  }

  async refreshFinanceStatus({ showErrors = false } = {}) {
    try {
      const status = await this.gateway.getFinanceStatus();
      this.state.financeConnected = Boolean(status.connected);
      this.state.financeConfigured = Boolean(status.configured);
      this.state.financeRequiresReconnect = Boolean(status.requiresReconnect);
      this.state.financeStatusError = status.statusMessage || "";
    } catch (error) {
      this.state.financeConnected = false;
      this.state.financeConfigured = false;
      this.state.financeRequiresReconnect = false;
      this.state.financeStatusError = error.message || "Status unavailable";

      if (showErrors) {
        this.showToast(this.state.financeStatusError);
      }
    }

    renderChrome(this.state, this.elements);
  }

  async refreshOuraStatus({ showErrors = false } = {}) {
    try {
      const status = await this.gateway.getOuraStatus();
      this.state.ouraConnected = Boolean(status.connected);
      this.state.ouraHasClientCredentials = Boolean(status.hasClientCredentials);
      this.state.ouraStatusError = "";
    } catch (error) {
      this.state.ouraConnected = false;
      this.state.ouraHasClientCredentials = false;
      this.state.ouraStatusError = error.message || "Status unavailable";

      if (showErrors) {
        this.showToast(this.state.ouraStatusError);
      }
    }

    renderChrome(this.state, this.elements);
  }

  applyIntegrationStatuses({ finance = {}, oura = {} } = {}) {
    this.state.financeConnected = Boolean(finance.connected);
    this.state.financeConfigured = Boolean(finance.configured);
    this.state.financeRequiresReconnect = Boolean(finance.requiresReconnect);
    this.state.financeStatusError = finance.statusMessage || "";
    this.state.ouraConnected = Boolean(oura.connected);
    this.state.ouraHasClientCredentials = Boolean(oura.hasClientCredentials);
    this.state.ouraStatusError = oura.error || "";
  }

  async refreshIntegrationStatuses({ autoConnect = false, startup = false, showErrors = false } = {}) {
    try {
      const statuses = await this.gateway.getIntegrationStatuses({ autoConnect, startup });
      this.applyIntegrationStatuses(statuses);

      if (showErrors && statuses?.finance?.statusMessage) {
        this.showToast(statuses.finance.statusMessage);
      }

      if (showErrors && statuses?.oura?.error) {
        this.showToast(statuses.oura.error);
      }
    } catch (error) {
      this.state.financeConnected = false;
      this.state.financeConfigured = false;
      this.state.financeRequiresReconnect = false;
      this.state.financeStatusError = error.message || "Status unavailable";
      this.state.ouraConnected = false;
      this.state.ouraHasClientCredentials = false;
      this.state.ouraStatusError = error.message || "Status unavailable";

      if (showErrors) {
        this.showToast(error.message || "Billbook could not refresh integrations.");
      }
    }

    renderChrome(this.state, this.elements);
  }

  async autoConnectIntegrations({ showErrors = false } = {}) {
    await this.refreshIntegrationStatuses({ autoConnect: true, startup: true, showErrors });
  }

  async refreshSidebarIntegrationStatuses({ showErrors = false } = {}) {
    await this.refreshIntegrationStatuses({ autoConnect: false, showErrors });
  }

  setCurrentEntry(entry, { markSaved = true } = {}) {
    this.cancelPendingSectionLoads();
    this.state.currentEntry = cloneEntry(entry);
    this.state.selectedFilePath = entry.filePath || "";
    this.state.savedSnapshot = markSaved ? snapshotEntry(entry) : "";
    this.state.hasExternalChanges = false;
    this.state.externalChangeMessage = "";

    this.elements.dateInput.value = entry.date || "";
    this.elements.titleInput.value = entry.title || "";
    this.syncSectionInputs(entry.sections);

    renderEditor(this.state, this.elements);
    this.queueSectionInputHeightSync();
    this.syncDirtyState();
  }

  cancelPendingSectionLoads() {
    this.sectionLoadToken += 1;
    this.pendingSectionLoads.clear();
    this.state.loadingSections.clear();
  }

  async waitForPendingSectionLoads() {
    if (!this.pendingSectionLoads.size) {
      return;
    }

    await Promise.allSettled([...this.pendingSectionLoads.values()]);
  }

  setSectionLoading(key, isLoading) {
    if (isLoading) {
      this.state.loadingSections.add(key);
    } else {
      this.state.loadingSections.delete(key);
    }

    renderEditor(this.state, this.elements);
  }

  applyAsyncSectionResult(token, key, content) {
    if (token !== this.sectionLoadToken || !this.state.currentEntry) {
      return;
    }

    this.pendingSectionLoads.delete(key);
    this.state.currentEntry.sections[key] = content;
    this.elements.sectionInputs[key].value = content;
    this.setSectionLoading(key, false);
    this.queueSectionInputHeightSync();
    this.scheduleDirtySync();
  }

  startGeneratedSectionLoads(dateString) {
    const token = this.sectionLoadToken;
    const financeTask = (async () => {
      const financeText = await this.buildFinanceSectionForDate(dateString);
      return this.applyMonthlyNetWorthSnapshot(financeText, dateString);
    })()
      .then((content) => this.applyAsyncSectionResult(token, "finances", content))
      .catch((error) => {
        this.applyAsyncSectionResult(
          token,
          "finances",
          this.buildFinanceErrorText(error.message || "Finance snapshot unavailable")
        );
      });
    const sleepTask = this.buildSleepSectionForDate(dateString)
      .then((content) => this.applyAsyncSectionResult(token, "sleep", content))
      .catch(() => {
        this.applyAsyncSectionResult(token, "sleep", this.buildSleepUnavailableText());
      });

    this.pendingSectionLoads.set("finances", financeTask);
    this.pendingSectionLoads.set("sleep", sleepTask);
    this.setSectionLoading("finances", true);
    this.setSectionLoading("sleep", true);
  }

  syncSectionInputs(sectionsLike = {}) {
    const sections = normalizeSections(sectionsLike);

    for (const { key } of DAILY_PROMPTS) {
      this.elements.sectionInputs[key].value = sections[key];
    }
  }

  resizeSectionInput(input) {
    if (!input) {
      return;
    }

    input.style.height = "0px";
    input.style.height = `${Math.max(130, input.scrollHeight)}px`;
  }

  syncSectionInputHeights() {
    for (const input of Object.values(this.elements.sectionInputs)) {
      this.resizeSectionInput(input);
    }
  }

  queueSectionInputHeightSync() {
    if (this.sectionResizeFrame) {
      window.cancelAnimationFrame(this.sectionResizeFrame);
    }

    this.sectionResizeFrame = window.requestAnimationFrame(() => {
      this.sectionResizeFrame = 0;
      this.syncSectionInputHeights();
    });
  }

  readSectionInputs() {
    return Object.fromEntries(
      DAILY_PROMPTS.map(({ key }) => [key, this.elements.sectionInputs[key].value])
    );
  }

  updateCurrentEntryFromInputs() {
    if (!this.state.currentEntry) {
      return;
    }

    this.state.currentEntry.date = this.elements.dateInput.value;
    this.state.currentEntry.title = this.elements.titleInput.value;
    this.state.currentEntry.sections = this.readSectionInputs();
  }

  syncDirtyState() {
    void this.gateway.setDirty(isDirty(this.state));
    renderSaveStatus(this.state, this.elements);
  }

  scheduleDirtySync() {
    if (this.dirtySyncFrame) {
      return;
    }

    this.dirtySyncFrame = window.requestAnimationFrame(() => {
      this.dirtySyncFrame = 0;
      this.syncDirtyState();
    });
  }

  applyInputToCurrentEntry(target) {
    if (!this.state.currentEntry || !target) {
      return;
    }

    if (target === this.elements.dateInput) {
      this.state.currentEntry.date = target.value;
      return;
    }

    if (target === this.elements.titleInput) {
      this.state.currentEntry.title = target.value;
      return;
    }

    for (const { key } of DAILY_PROMPTS) {
      if (target === this.elements.sectionInputs[key]) {
        this.state.currentEntry.sections[key] = target.value;
        return;
      }
    }
  }

  markInternalWrite(filePath) {
    if (!filePath) {
      return;
    }

    this.internalWriteGuards.set(getBasename(filePath), Date.now() + 1200);
  }

  shouldIgnoreDirectoryChange(payload) {
    const filename = payload?.filename ? getBasename(payload.filename) : "";

    if (!filename) {
      return false;
    }

    const now = Date.now();

    for (const [guardedFile, expiresAt] of this.internalWriteGuards.entries()) {
      if (expiresAt <= now) {
        this.internalWriteGuards.delete(guardedFile);
      }
    }

    const expiresAt = this.internalWriteGuards.get(filename);

    if (!expiresAt || expiresAt <= now) {
      return false;
    }

    return true;
  }

  async showConfirmDialog({ title, body, actions }) {
    this.elements.confirmTitle.textContent = title;
    this.elements.confirmBody.textContent = body;
    this.elements.confirmActions.innerHTML = "";

    for (const action of actions) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `button ${action.variant === "primary" ? "button-primary" : "button-secondary"}`;
      button.textContent = action.label;
      button.dataset.action = action.id;
      this.elements.confirmActions.append(button);
    }

    return new Promise((resolve) => {
      const handleClick = (event) => {
        const { action } = event.target.dataset;

        if (!action) {
          return;
        }

        cleanup();
        this.elements.confirmDialog.close(action);
        resolve(action);
      };

      const handleCancel = () => {
        cleanup();
        resolve("cancel");
      };

      const cleanup = () => {
        this.elements.confirmActions.removeEventListener("click", handleClick);
        this.elements.confirmDialog.removeEventListener("cancel", handleCancel);
      };

      this.elements.confirmActions.addEventListener("click", handleClick);
      this.elements.confirmDialog.addEventListener("cancel", handleCancel, { once: true });
      this.elements.confirmDialog.showModal();
    });
  }

  async showFinanceWarnings(warnings = []) {
    if (!Array.isArray(warnings) || !warnings.length) {
      return;
    }

    await this.showConfirmDialog({
      title: "SimpleFIN message",
      body: warnings.join("\n"),
      actions: [{ id: "ok", label: "OK", variant: "primary" }]
    });
  }

  async showOuraCredentialsDialog() {
    this.elements.ouraClientIdInput.value = "";
    this.elements.ouraClientSecretInput.value = "";

    return new Promise((resolve) => {
      const cleanup = () => {
        this.elements.ouraCancelButton.removeEventListener("click", handleCancel);
        this.elements.ouraSaveButton.removeEventListener("click", handleSave);
        this.elements.ouraCredentialsDialog.removeEventListener("cancel", handleCancel);
      };

      const handleCancel = () => {
        cleanup();
        this.elements.ouraCredentialsDialog.close("cancel");
        resolve(null);
      };

      const handleSave = () => {
        const clientId = this.elements.ouraClientIdInput.value.trim();
        const clientSecret = this.elements.ouraClientSecretInput.value.trim();

        if (!clientId || !clientSecret) {
          this.showToast("Enter both the Oura client ID and client secret");
          return;
        }

        cleanup();
        this.elements.ouraCredentialsDialog.close("save");
        resolve({
          clientId,
          clientSecret
        });
      };

      this.elements.ouraCancelButton.addEventListener("click", handleCancel);
      this.elements.ouraSaveButton.addEventListener("click", handleSave);
      this.elements.ouraCredentialsDialog.addEventListener("cancel", handleCancel, { once: true });
      this.elements.ouraCredentialsDialog.showModal();
    });
  }

  buildFinanceConfigFromDialog() {
    const netWorthAccountIds = [];
    const spendingAccountIds = [];

    for (const checkbox of this.elements.financeAccountList.querySelectorAll("input[type='checkbox']")) {
      if (!checkbox.checked) {
        continue;
      }

      if (checkbox.dataset.role === "netWorth") {
        netWorthAccountIds.push(checkbox.dataset.accountId);
      }

      if (checkbox.dataset.role === "spending") {
        spendingAccountIds.push(checkbox.dataset.accountId);
      }
    }

    return {
      netWorthAccountIds,
      spendingAccountIds
    };
  }

  async showFinanceConfigDialog({ accounts, financeConfig }) {
    this.elements.financeAccountList.innerHTML = "";

    for (const account of accounts) {
      const row = document.createElement("div");
      row.className = "finance-account-row";

      const copy = document.createElement("div");
      copy.className = "finance-account-copy";

      const name = document.createElement("p");
      name.className = "finance-account-name";
      name.textContent = account.name;

      const meta = document.createElement("p");
      meta.className = "finance-account-meta";
      meta.textContent = account.connectionName
        ? `${account.connectionName} · Balance ${account.balance.toFixed(2)} ${account.currency}`
        : `Balance ${account.balance.toFixed(2)} ${account.currency}`;

      copy.append(name, meta);

      const controls = document.createElement("div");
      controls.className = "finance-account-controls";

      const netWorthLabel = document.createElement("label");
      netWorthLabel.className = "finance-role-toggle";
      const netWorthCheckbox = document.createElement("input");
      netWorthCheckbox.type = "checkbox";
      netWorthCheckbox.dataset.role = "netWorth";
      netWorthCheckbox.dataset.accountId = account.id;
      netWorthCheckbox.checked = financeConfig.netWorthAccountIds.includes(account.id);
      const netWorthText = document.createElement("span");
      netWorthText.textContent = "Net Worth";
      netWorthLabel.append(netWorthCheckbox, netWorthText);

      const spendingLabel = document.createElement("label");
      spendingLabel.className = "finance-role-toggle";
      const spendingCheckbox = document.createElement("input");
      spendingCheckbox.type = "checkbox";
      spendingCheckbox.dataset.role = "spending";
      spendingCheckbox.dataset.accountId = account.id;
      spendingCheckbox.checked = financeConfig.spendingAccountIds.includes(account.id);
      const spendingText = document.createElement("span");
      spendingText.textContent = "Spending";
      spendingLabel.append(spendingCheckbox, spendingText);

      controls.append(netWorthLabel, spendingLabel);
      row.append(copy, controls);
      this.elements.financeAccountList.append(row);
    }

    return new Promise((resolve) => {
      const cleanup = () => {
        this.elements.financeCancelButton.removeEventListener("click", handleCancel);
        this.elements.financeSaveButton.removeEventListener("click", handleSave);
        this.elements.financeDialog.removeEventListener("cancel", handleCancel);
      };

      const handleCancel = () => {
        cleanup();
        this.elements.financeDialog.close("cancel");
        resolve(null);
      };

      const handleSave = () => {
        const config = this.buildFinanceConfigFromDialog();
        cleanup();
        this.elements.financeDialog.close("save");
        resolve(config);
      };

      this.elements.financeCancelButton.addEventListener("click", handleCancel);
      this.elements.financeSaveButton.addEventListener("click", handleSave);
      this.elements.financeDialog.addEventListener("cancel", handleCancel, { once: true });
      this.elements.financeDialog.showModal();
    });
  }

  async buildFinanceSectionForDate(dateString) {
    if (!this.state.financeConnected || !this.state.financeConfigured) {
      return this.buildFinanceErrorText(
        !this.state.financeConnected
          ? this.state.financeStatusError || "SimpleFIN is not connected."
          : "Finance accounts are not configured."
      );
    }

    try {
      const result = await this.gateway.buildFinanceSection(dateString);
      const warnings = Array.isArray(result?.warnings) ? result.warnings.filter(Boolean) : [];
      const content = typeof result?.content === "string" ? result.content.trim() : "";

      if (warnings.length) {
        this.showToast(warnings[0]);
      }

      if (content) {
        return content;
      }

      if (warnings.length) {
        return this.buildFinanceErrorText(warnings.join(" "));
      }

      return this.buildFinanceErrorText("SimpleFIN returned no finance data for this entry.");
    } catch (error) {
      const message = error.message || "Finance snapshot unavailable";
      this.showToast(message);
      return this.buildFinanceErrorText(message);
    }
  }

  async buildSleepSectionForDate(dateString) {
    if (!this.state.ouraConnected) {
      return this.buildSleepUnavailableText();
    }

    try {
      const result = await this.gateway.buildSleepSection(dateString);
      const content = typeof result?.content === "string" ? result.content.trim() : "";

      if (content) {
        return content;
      }

      return this.buildSleepUnavailableText();
    } catch (error) {
      const message = error.message || "Oura sleep unavailable";
      this.showToast(message);
      await this.refreshOuraStatus();
      return this.buildSleepUnavailableText();
    }
  }

  async applyMonthlyNetWorthSnapshot(financeText, dateString) {
    if (!financeText || /Finance Snapshot Error/i.test(financeText)) {
      return financeText;
    }

    const existingMonthSnapshot = await this.findMonthlyNetWorthSnapshot(dateString);

    if (!existingMonthSnapshot) {
      return financeText;
    }

    return this.replaceNetWorthBlock(financeText, existingMonthSnapshot.block);
  }

  async ensureJournalDirectory() {
    if (this.state.journalDirectory && !this.state.journalDirectoryMissing) {
      return true;
    }

    const settings = await this.gateway.chooseJournalDirectory();
    this.state.journalDirectory = settings.journalDirectory || "";
    this.state.journalDirectoryMissing = Boolean(settings.journalDirectoryMissing);
    renderChrome(this.state, this.elements);

    if (!this.state.journalDirectory) {
      return false;
    }

    await this.loadEntries();
    return true;
  }

  async loadEntries({ preserveSelection = true } = {}) {
    const hadUnsavedChanges = isDirty(this.state);
    const {
      journalDirectory,
      journalDirectoryMissing,
      entries,
      entryLoadErrors = []
    } = await this.gateway.listEntries();
    this.state.journalDirectory = journalDirectory;
    this.state.journalDirectoryMissing = Boolean(journalDirectoryMissing);
    this.state.entries = entries;

    if (Array.isArray(entryLoadErrors) && entryLoadErrors.length) {
      this.showToast(
        entryLoadErrors.length === 1
          ? "One journal entry could not be loaded."
          : `${entryLoadErrors.length} journal entries could not be loaded.`
      );
    }

    if (this.state.journalDirectoryMissing) {
      if (!hadUnsavedChanges) {
        this.state.currentEntry = null;
        this.state.selectedFilePath = "";
        this.state.savedSnapshot = "";
      }

      this.state.hasExternalChanges = false;
      this.state.externalChangeMessage = "";
      renderApp(this.state, this.elements);
      return;
    }

    if (!preserveSelection || !this.state.selectedFilePath) {
      if (!hadUnsavedChanges) {
        this.state.currentEntry = null;
        this.state.selectedFilePath = "";
        this.state.savedSnapshot = "";
      }

      renderApp(this.state, this.elements);
      return;
    }

    const selectedEntryExists = this.state.entries.some((entry) => entry.filePath === this.state.selectedFilePath);

    if (!selectedEntryExists && !isDirty(this.state)) {
      this.state.currentEntry = null;
      this.state.selectedFilePath = "";
      this.state.savedSnapshot = "";
    }

    renderApp(this.state, this.elements);
  }

  async loadEntry(filePath) {
    const entry = await this.gateway.readEntry(filePath);
    this.setCurrentEntry(entry);
    renderApp(this.state, this.elements);
  }

  async maybeHandleUnsavedChanges() {
    if (!isDirty(this.state)) {
      return true;
    }

    const action = await this.showConfirmDialog({
      title: "Unsaved changes",
      body: "Save this entry before continuing?",
      actions: [
        { id: "cancel", label: "Cancel", variant: "secondary" },
        { id: "discard", label: "Discard", variant: "secondary" },
        { id: "save", label: "Save Entry", variant: "primary" }
      ]
    });

    if (action === "save") {
      return this.saveCurrentEntry();
    }

    return action === "discard";
  }

  async saveCurrentEntry() {
    if (!this.state.currentEntry) {
      return true;
    }

    if (!(await this.ensureJournalDirectory())) {
      return false;
    }

    await this.waitForPendingSectionLoads();
    this.updateCurrentEntryFromInputs();

    if (!this.state.currentEntry.date) {
      this.state.currentEntry.date = createBlankDraft().date;
      this.elements.dateInput.value = this.state.currentEntry.date;
    }

    try {
      const previousFilePath = this.state.selectedFilePath;
      const { entry } = await this.gateway.saveEntry(this.state.currentEntry);
      this.markInternalWrite(previousFilePath);
      this.markInternalWrite(entry.filePath);
      this.state.entries = this.state.entries.filter((item) => item.filePath !== this.state.selectedFilePath);
      this.setCurrentEntry(entry);
      await this.loadEntries();
      renderApp(this.state, this.elements);
      return true;
    } catch (error) {
      await this.showConfirmDialog({
        title: "Save failed",
        body: error.message || "The entry could not be saved.",
        actions: [{ id: "ok", label: "OK", variant: "primary" }]
      });
      return false;
    }
  }

  async handleNewEntry() {
    const canContinue = await this.maybeHandleUnsavedChanges();

    if (!canContinue) {
      return;
    }

    const draft = createBlankDraft();
    this.setCurrentEntry(draft, { markSaved: false });
    this.startGeneratedSectionLoads(draft.date);
    renderApp(this.state, this.elements);
    this.elements.titleInput.focus();
  }

  async handleEntrySelection(filePath) {
    if (filePath === this.state.selectedFilePath) {
      return;
    }

    const canContinue = await this.maybeHandleUnsavedChanges();

    if (!canContinue) {
      return;
    }

    await this.loadEntry(filePath);
  }

  async handleChooseFolder() {
    const canContinue = await this.maybeHandleUnsavedChanges();

    if (!canContinue) {
      return;
    }

    const settings = await this.gateway.chooseJournalDirectory();
    const previousDirectory = this.state.journalDirectory;
    this.state.journalDirectory = settings.journalDirectory || "";
    this.state.journalDirectoryMissing = Boolean(settings.journalDirectoryMissing);
    this.state.currentEntry = null;
    this.state.selectedFilePath = "";
    this.state.savedSnapshot = "";
    await this.loadEntries({ preserveSelection: false });

    if (this.state.journalDirectory && this.state.journalDirectory !== previousDirectory) {
      this.showToast(`Folder selected: ${shortenPath(this.state.journalDirectory)}`);
    }
  }

  async handleOpenJournalDirectory() {
    try {
      await this.gateway.openJournalDirectory();
    } catch (error) {
      await this.showConfirmDialog({
        title: "Folder unavailable",
        body: error.message || "The journal folder could not be opened.",
        actions: [{ id: "ok", label: "OK", variant: "primary" }]
      });
    }
  }

  async handleRevealCurrentEntry() {
    if (!this.state.selectedFilePath) {
      return;
    }

    try {
      await this.gateway.revealEntry(this.state.selectedFilePath);
    } catch (error) {
      await this.showConfirmDialog({
        title: "Entry unavailable",
        body: error.message || "The current entry could not be shown in Finder.",
        actions: [{ id: "ok", label: "OK", variant: "primary" }]
      });
    }
  }

  toggleSidebarMenu() {
    this.state.isSidebarMenuOpen = !this.state.isSidebarMenuOpen;
    renderChrome(this.state, this.elements);

    if (this.state.isSidebarMenuOpen) {
      void this.refreshSidebarIntegrationStatuses();
    }
  }

  closeSidebarMenu() {
    if (!this.state.isSidebarMenuOpen) {
      return;
    }

    this.state.isSidebarMenuOpen = false;
    renderChrome(this.state, this.elements);
  }

  async handleToggleAutoConnect() {
    this.closeSidebarMenu();

    try {
      const settings = await this.gateway.saveIntegrationPreferences({
        autoConnectOnStartup: !this.state.autoConnectIntegrationsOnStartup
      });

      this.state.autoConnectIntegrationsOnStartup = Boolean(
        settings.integrations?.autoConnectOnStartup
      );
      renderChrome(this.state, this.elements);

      if (this.state.autoConnectIntegrationsOnStartup) {
        this.showToast("Startup auto-connect enabled");
        await this.autoConnectIntegrations({ showErrors: true });
        return;
      }

      this.showToast("Startup auto-connect disabled");
    } catch (error) {
      await this.showConfirmDialog({
        title: "Integration settings unavailable",
        body: error.message || "Billbook could not update its startup connection setting.",
        actions: [{ id: "ok", label: "OK", variant: "primary" }]
      });
    }
  }

  async handleCreateBackup() {
    this.closeSidebarMenu();

    if (!this.state.journalDirectory || this.state.journalDirectoryMissing) {
      await this.showConfirmDialog({
        title: "Backup unavailable",
        body: "Choose a valid journal folder before creating a backup.",
        actions: [{ id: "ok", label: "OK", variant: "primary" }]
      });
      return;
    }

    if (isDirty(this.state)) {
      const action = await this.showConfirmDialog({
        title: "Save before backup?",
        body: "The backup only includes files already written to disk. Save your current entry first?",
        actions: [
          { id: "save", label: "Save and Back Up", variant: "primary" },
          { id: "backup", label: "Back Up Without Saving", variant: "secondary" },
          { id: "cancel", label: "Cancel", variant: "secondary" }
        ]
      });

      if (action === "cancel") {
        return;
      }

      if (action === "save") {
        const saved = await this.saveCurrentEntry();

        if (!saved) {
          return;
        }
      }
    }

    try {
      const result = await this.gateway.createBackup();

      if (result?.canceled || !result?.backupDirectory) {
        return;
      }

      this.showToast(`Backup created: ${getBasename(result.backupDirectory)}`);
    } catch (error) {
      await this.showConfirmDialog({
        title: "Backup failed",
        body: error.message || "The journal backup could not be created.",
        actions: [{ id: "ok", label: "OK", variant: "primary" }]
      });
    }
  }

  async handleConnectSimplefin() {
    this.closeSidebarMenu();

    try {
      const result = await this.gateway.connectSimplefinFromFile();

      if (result?.canceled) {
        return;
      }

      await this.showFinanceWarnings(result?.warnings || []);
      await this.refreshFinanceStatus();

      if (!Array.isArray(result?.accounts) || !result.accounts.length) {
        this.showToast("SimpleFIN connected");
        return;
      }

      const financeConfig = await this.showFinanceConfigDialog({
        accounts: result.accounts,
        financeConfig: result.financeConfig
      });

      if (financeConfig) {
        await this.gateway.saveFinanceConfig(financeConfig);
        await this.refreshFinanceStatus();
        this.showToast("SimpleFIN connected");
        return;
      }

      this.showToast("SimpleFIN connected");
    } catch (error) {
      await this.refreshFinanceStatus();
      await this.showConfirmDialog({
        title: "SimpleFIN unavailable",
        body: error.message || "Billbook could not connect to SimpleFIN.",
        actions: [{ id: "ok", label: "OK", variant: "primary" }]
      });
    }
  }

  async handleConnectOura() {
    this.closeSidebarMenu();

    try {
      const status = await this.gateway.getOuraStatus();

      if (!status?.hasClientCredentials) {
        const credentials = await this.showOuraCredentialsDialog();

        if (!credentials) {
          return;
        }

        await this.gateway.saveOuraClientCredentials(credentials);
      }

      const result = await this.gateway.connectOura();

      if (result?.connected) {
        await this.refreshOuraStatus();
        this.showToast("Oura connected");
      }
    } catch (error) {
      await this.refreshOuraStatus();
      await this.showConfirmDialog({
        title: "Oura unavailable",
        body: error.message || "Billbook could not connect to Oura.",
        actions: [{ id: "ok", label: "OK", variant: "primary" }]
      });
    }
  }

  async handleConfigureFinance() {
    this.closeSidebarMenu();

    try {
      const result = await this.gateway.listFinanceAccounts();
      await this.showFinanceWarnings(result?.warnings || []);

      if (!Array.isArray(result?.accounts) || !result.accounts.length) {
        await this.showConfirmDialog({
          title: "No finance accounts",
          body: "Billbook could not find any connected SimpleFIN accounts yet.",
          actions: [{ id: "ok", label: "OK", variant: "primary" }]
        });
        return;
      }

      const financeConfig = await this.showFinanceConfigDialog({
        accounts: result.accounts,
        financeConfig: result.financeConfig
      });

      if (!financeConfig) {
        return;
      }

      await this.gateway.saveFinanceConfig(financeConfig);
      await this.refreshFinanceStatus();
      this.showToast("Finance accounts saved");
    } catch (error) {
      await this.showConfirmDialog({
        title: "Finance setup unavailable",
        body: error.message || "Billbook could not load your finance accounts.",
        actions: [{ id: "ok", label: "OK", variant: "primary" }]
      });
    }
  }

  handleEditorInput(event) {
    this.applyInputToCurrentEntry(event.target);

    if (event.target?.classList?.contains("section-input")) {
      this.resizeSectionInput(event.target);
    }

    this.scheduleDirtySync();
  }

  async handleExternalChanges(payload) {
    if (this.shouldIgnoreDirectoryChange(payload)) {
      return;
    }

    const currentPath = this.state.selectedFilePath;
    const dirty = isDirty(this.state);

    await this.loadEntries();

    if (!currentPath) {
      return;
    }

    const selectedStillExists = this.state.entries.some((entry) => entry.filePath === currentPath);

    if (!selectedStillExists) {
      if (!dirty) {
        this.state.currentEntry = null;
        this.state.selectedFilePath = "";
        this.state.savedSnapshot = "";
        renderApp(this.state, this.elements);
        this.showToast("Note removed from disk");
        return;
      }

      this.state.hasExternalChanges = true;
      this.state.externalChangeMessage = "This note was removed outside Billbook.";
      renderChrome(this.state, this.elements);
      return;
    }

    if (dirty) {
      this.state.hasExternalChanges = true;
      this.state.externalChangeMessage = "This note changed outside Billbook.";
      renderChrome(this.state, this.elements);
      return;
    }

    await this.loadEntry(currentPath);
    this.showToast("Updated from disk");
  }

  async handleReloadFromDisk() {
    if (!this.state.selectedFilePath) {
      return;
    }

    await this.loadEntry(this.state.selectedFilePath);
    this.showToast("Reloaded from disk");
  }

  handleKeepMine() {
    this.state.hasExternalChanges = false;
    this.state.externalChangeMessage = "";
    renderChrome(this.state, this.elements);
  }

  async handleEmptyStateAction() {
    const view = getEditorView(this.state);

    if (view.mode === "no-folder") {
      await this.handleChooseFolder();
      return;
    }

    if (view.mode === "missing-folder") {
      await this.handleChooseFolder();
      return;
    }

    if (view.mode === "no-selection") {
      await this.handleNewEntry();
    }
  }

  handleWeekToggle(weekKey) {
    const selectedWeekKey = getSelectedWeekKey(this.state.currentEntry);

    if (!weekKey || weekKey === selectedWeekKey) {
      return;
    }

    if (this.state.expandedWeeks.has(weekKey)) {
      this.state.expandedWeeks.delete(weekKey);
    } else {
      this.state.expandedWeeks.add(weekKey);
    }

    renderApp(this.state, this.elements);
  }

  handleYearToggle(yearKey) {
    const selectedYearKey = getSelectedYearKey(this.state.currentEntry);

    if (!yearKey || yearKey === selectedYearKey) {
      return;
    }

    if (this.state.collapsedYears.has(yearKey)) {
      this.state.collapsedYears.delete(yearKey);
    } else {
      this.state.collapsedYears.add(yearKey);
    }

    renderApp(this.state, this.elements);
  }

  handleMonthToggle(monthKey) {
    const selectedMonthKey = getSelectedMonthKey(this.state.currentEntry);

    if (!monthKey || monthKey === selectedMonthKey) {
      return;
    }

    if (this.state.collapsedMonths.has(monthKey)) {
      this.state.collapsedMonths.delete(monthKey);
    } else {
      this.state.collapsedMonths.add(monthKey);
    }

    renderApp(this.state, this.elements);
  }

  bindEvents() {
    this.elements.directoryLink.addEventListener("click", () => this.handleOpenJournalDirectory());
    this.elements.editorSubtitle.addEventListener("click", () => this.handleRevealCurrentEntry());
    this.elements.sidebarMenuButton.addEventListener("click", (event) => {
      event.stopPropagation();
      this.toggleSidebarMenu();
    });
    this.elements.connectSimplefinButton.addEventListener("click", async () => this.handleConnectSimplefin());
    this.elements.connectOuraButton.addEventListener("click", async () => this.handleConnectOura());
    this.elements.configureFinanceButton.addEventListener("click", async () =>
      this.handleConfigureFinance()
    );
    this.elements.toggleAutoConnectButton.addEventListener("click", async () =>
      this.handleToggleAutoConnect()
    );
    this.elements.backupJournalButton.addEventListener("click", async () => this.handleCreateBackup());
    this.elements.chooseFolderButton.addEventListener("click", () => this.handleChooseFolder());
    this.elements.emptyStateButton.addEventListener("click", () => this.handleEmptyStateAction());
    this.elements.newEntryButton.addEventListener("click", () => this.handleNewEntry());
    this.elements.reloadEntryButton.addEventListener("click", () => this.handleReloadFromDisk());
    this.elements.keepMineButton.addEventListener("click", () => this.handleKeepMine());
    this.elements.dateInput.addEventListener("input", (event) => this.handleEditorInput(event));
    this.elements.titleInput.addEventListener("input", (event) => this.handleEditorInput(event));

    for (const input of Object.values(this.elements.sectionInputs)) {
      input.addEventListener("input", (event) => this.handleEditorInput(event));
    }

    this.elements.entriesTree.addEventListener("click", async (event) => {
      const yearButton = event.target.closest(".group-heading");

      if (yearButton) {
        this.handleYearToggle(yearButton.dataset.yearKey);
        return;
      }

      const monthButton = event.target.closest(".month-heading");

      if (monthButton) {
        this.handleMonthToggle(monthButton.dataset.monthKey);
        return;
      }

      const weekButton = event.target.closest(".week-heading");

      if (weekButton) {
        this.handleWeekToggle(weekButton.dataset.weekKey);
        return;
      }

      const entryButton = event.target.closest(".entry-button");

      if (!entryButton) {
        return;
      }

      await this.handleEntrySelection(entryButton.dataset.filePath);
    });

    window.addEventListener("keydown", async (event) => {
      if (event.key === "Escape") {
        this.closeSidebarMenu();
      }

      const savePressed = (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s";

      if (!savePressed) {
        return;
      }

      event.preventDefault();
      await this.saveCurrentEntry();
    });

    window.addEventListener("click", (event) => {
      if (event.target.closest(".sidebar-footer")) {
        return;
      }

      this.closeSidebarMenu();
    });

    this.gateway.onDirectoryChanged(async (payload) => {
      await this.handleExternalChanges(payload);
    });

    this.gateway.onSaveBeforeClose(async () => {
      const saved = await this.saveCurrentEntry();

      if (saved) {
        await this.gateway.closeAfterSave();
      }
    });
  }

  async initialize() {
    this.bindEvents();

    const settings = await this.gateway.loadSettings();
    this.state.journalDirectory = settings.journalDirectory || "";
    this.state.journalDirectoryMissing = Boolean(settings.journalDirectoryMissing);
    this.state.financeConfigured = Boolean(
      settings.finance?.netWorthAccountIds?.length || settings.finance?.spendingAccountIds?.length
    );
    this.state.financeConnected = Boolean(
      settings.integrations?.simplefinConnectedHint || this.state.financeConfigured
    );
    this.state.ouraConnected = Boolean(settings.integrations?.ouraConnectedHint);
    this.state.autoConnectIntegrationsOnStartup =
      settings.integrations?.autoConnectOnStartup !== false;
    await this.loadEntries({ preserveSelection: false });
    renderApp(this.state, this.elements);

    if (this.state.autoConnectIntegrationsOnStartup) {
      window.requestAnimationFrame(() => {
        void this.autoConnectIntegrations({ showErrors: true });
      });
    }
  }
}
