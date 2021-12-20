import {
    Disposable,
    Event,
    EventEmitter,
    ExtensionContext,
    FileSystemWatcher,
    Uri,
    commands,
    window,
    workspace
} from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { ExtensionApi } from '../api';
import { getConfigAndReplaceVariables } from '../../utils/config';
import { ProcessType, ScheduledProcess } from '.';

export class ExecutorBridge implements Disposable {
    private versionChecked?: boolean;
    private shownVersionWarning: boolean = false;

    private databaseWatches: FileSystemWatcher[] = [];
    private databaseEvents: Disposable[] = [];
    private databasePaths: (string | undefined)[] = [];

    /** Every line should have a newline at the end */
    private _bridgeMessages: EventEmitter<string> = new EventEmitter();
    /**
     * Messages emitted by the Executor bridge.
     * ``>>> metadata`` for all messages.
     */
    public get bridgeMessages(): Event<string> {
        return this._bridgeMessages.event;
    }

    private _databaseLocationChanged: EventEmitter<void> = new EventEmitter();
    public get databaseLocationChanged(): Event<void> {
        return this._databaseLocationChanged.event;
    }

    /** Automatically adds itself to ctx.subscriptions. */
    constructor(ctx: ExtensionContext) {
        ctx.subscriptions.push(this);

        workspace.onDidSaveTextDocument(this.analyzeOnSave, this, ctx.subscriptions);
        workspace.onDidChangeConfiguration(this.updateDatabasePaths, this, ctx.subscriptions);

        ctx.subscriptions.push(
            commands.registerCommand('codechecker.executor.analyzeCurrentFile', this.analyzeCurrentFile, this)
        );
        ctx.subscriptions.push(
            commands.registerCommand('codechecker.executor.analyzeSelectedFiles', this.selectAndAnalyzeFile, this)
        );
        ctx.subscriptions.push(
            commands.registerCommand('codechecker.executor.analyzeProject', this.analyzeProject, this)
        );
        ctx.subscriptions.push(commands.registerCommand('codechecker.executor.stopAnalysis', this.stopAnalysis, this));

        this.updateDatabasePaths();
    }

    dispose() {
        this.databaseEvents.forEach(watch => watch.dispose());
        this.databaseWatches.forEach(watch => watch.dispose());
    }

    /**
     * `updateDatabasePaths` should be run at least once before calling this function, to initialize the database paths.
     * Otherwise, it will return undefined.
     */
    public getCompileCommandsPath() {
        if (!workspace.workspaceFolders?.length) {
            return undefined;
        }

        for (const filePath of this.databasePaths) {
            if (filePath && fs.existsSync(filePath)) {
                this._bridgeMessages.fire(`>>> Database found at path: ${filePath}\n`);
                // TODO: Cache the result and only update on eg. watch change
                return filePath;
            }
        }

        this._bridgeMessages.fire('>>> No database found in the following paths:\n');
        for (const filePath of this.databasePaths) {
            if (filePath) {
                this._bridgeMessages.fire(`>>>   ${filePath}\n`);
            } else {
                this._bridgeMessages.fire('>>>   <no path set in settings>\n');
            }
        }

        return undefined;
    }

    public getAnalyzeCmdLine(...files: Uri[]): string | undefined {
        if (!workspace.workspaceFolders?.length) {
            return undefined;
        }

        // TODO: Refactor for less code repetition across functions
        const workspaceFolder = workspace.workspaceFolders[0].uri.fsPath;

        const ccPath = getConfigAndReplaceVariables('codechecker.executor', 'executablePath')
            ?? 'CodeChecker';
        const ccFolder = getConfigAndReplaceVariables('codechecker.backend', 'outputFolder')
            ?? path.join(workspaceFolder, '.codechecker');
        const ccArguments = getConfigAndReplaceVariables('codechecker.executor', 'arguments') ?? '';
        const ccThreads = workspace.getConfiguration('codechecker.executor').get<string>('threadCount');

        const ccCompileCmd = this.getCompileCommandsPath();

        if (ccCompileCmd === undefined) {
            window.showWarningMessage('No compilation database found, CodeChecker not started - see logs for details');
            return undefined;
        }

        const filePaths = files.length
            ? `--file ${files.map((uri) => `"${uri.fsPath}"`).join(' ')}`
            : '';

        return [
            `${ccPath} analyze`,
            `"${ccCompileCmd}"`,
            `--output "${ccFolder}"`,
            `${ccThreads ? '-j ' + ccThreads : ''}`,
            `${ccArguments}`,
            `${filePaths}`,
        ].join(' ');
    }

    public getLogCmdLine(): string | undefined {
        if (!workspace.workspaceFolders?.length) {
            return undefined;
        }

        const workspaceFolder = workspace.workspaceFolders[0].uri.fsPath;

        const ccPath = getConfigAndReplaceVariables('codechecker.executor', 'executablePath')
            ?? 'CodeChecker';
        const ccFolder = getConfigAndReplaceVariables('codechecker.backend', 'outputFolder')
            ?? path.join(workspaceFolder, '.codechecker');

        // Use a predefined path here
        const ccCompileCmd = path.join(ccFolder, 'compile_commands.json');

        return [
            `${ccPath} log`,
            `--output "${ccCompileCmd}"`,
            '--build "make"'
        ].join(' ');
    }

    private analyzeOnSave() {
        const canAnalyzeOnSave = workspace.getConfiguration('codechecker.executor').get<boolean>('runOnSave');
        // Fail silently if there's no compile_commands.json
        const ccExists = this.getCompileCommandsPath() !== undefined;

        if (!canAnalyzeOnSave || !ccExists) {
            return;
        }

        this.analyzeCurrentFile();
    }

    public async selectAndAnalyzeFile(...files: string[]) {
        if (files.length > 0) {
            for (const file of files) {
                this.analyzeFile(Uri.file(file));
            }

            return;
        }

        const selectedFiles = await window.showOpenDialog({ canSelectFiles: true, canSelectMany: true });

        if (selectedFiles !== undefined) {
            for (const file of selectedFiles) {
                this.analyzeFile(file);
            }
        }
    }

    public analyzeCurrentFile() {
        const currentFile = window.activeTextEditor?.document.uri;

        if (currentFile !== undefined) {
            this.analyzeFile(currentFile);
        }
    }

    public analyzeFile(file: Uri) {
        const commandLine = this.getAnalyzeCmdLine(file);

        if (commandLine === undefined) {
            return;
        }

        const process = new ScheduledProcess(commandLine, { processType: ProcessType.analyze });

        ExtensionApi.executorManager.addToQueue(process, 'prepend');
    }

    public analyzeProject() {
        // Kill the process, since the entire project is getting analyzed anyways
        this.stopAnalysis();

        const commandLine = this.getAnalyzeCmdLine();

        if (commandLine === undefined) {
            return;
        }

        const process = new ScheduledProcess(commandLine, { processType: ProcessType.analyze });

        ExtensionApi.executorManager.addToQueue(process, 'replace');
    }

    public stopAnalysis() {
        ExtensionApi.executorManager.clearQueue(ProcessType.analyze);

        if (ExtensionApi.executorManager.activeProcess?.processParameters.processType === ProcessType.analyze) {
            ExtensionApi.executorManager.killProcess();
        }
    }

    private updateDatabasePaths() {
        if (!workspace.workspaceFolders?.length) {
            return;
        }

        const workspaceFolder = workspace.workspaceFolders[0].uri.fsPath;

        const ccFolder = getConfigAndReplaceVariables('codechecker.backend', 'outputFolder')
            ?? path.join(workspaceFolder, '.codechecker');

        this.databasePaths = [
            getConfigAndReplaceVariables('codechecker.backend', 'databasePath'),
            path.join(ccFolder, 'compile_commands.json'),
            path.join(ccFolder, 'compile_cmd.json')
        ];

        this.databaseEvents.forEach(watch => watch.dispose());
        this.databaseWatches.forEach(watch => watch.dispose());

        this.databaseWatches = this.databasePaths
            .filter(x => x !== undefined)
            .map(path => workspace.createFileSystemWatcher(path!));

        for (const watch of this.databaseWatches) {
            this.databaseEvents.push(watch.onDidCreate(() => this._databaseLocationChanged.fire()));
            this.databaseEvents.push(watch.onDidDelete(() => this._databaseLocationChanged.fire()));
        }

        this._databaseLocationChanged.fire();
    }
}