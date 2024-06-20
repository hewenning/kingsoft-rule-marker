import * as vscode from 'vscode';
import * as ts from 'typescript';

let warningDecorationType: vscode.TextEditorDecorationType;
const warnings: { [key: string]: { range: vscode.Range, usages: vscode.Range[] } } = {};
const scannedFiles: Set<string> = new Set();

export function activate(context: vscode.ExtensionContext) {
    warningDecorationType = vscode.window.createTextEditorDecorationType({
        color: 'orange', // 将字体颜色变为橙色
        overviewRulerColor: 'orange',
        overviewRulerLane: vscode.OverviewRulerLane.Right,
        textDecoration: 'underline dashed orange', // 将虚线改为橙色
    });

    vscode.workspace.onDidOpenTextDocument(handleDocumentChange, null, context.subscriptions);
    vscode.workspace.onDidChangeTextDocument(event => handleDocumentChange(event.document), null, context.subscriptions);
    vscode.window.onDidChangeActiveTextEditor(editor => {
        if (editor) {
            handleDocumentChange(editor.document);
        }
    }, null, context.subscriptions);

    const activeEditor = vscode.window.activeTextEditor;
    if (activeEditor) {
        handleDocumentChange(activeEditor.document);
    }

    // 同步初次激活时扫描所有需要的文件
    initializeScan();
}

function initializeScan() {
    const globPatterns = [
        'packages/client/**/*.ts',
        'packages/common/**/*.ts',
        'packages/dedicated-server/**/*.ts',
        'packages/logic-server/**/*.ts'
    ];

    for (const pattern of globPatterns) {
        vscode.workspace.findFiles(pattern, '**/node_modules/**').then(files => {
            files.forEach(file => {
                if (!scannedFiles.has(file.fsPath)) {
                    scannedFiles.add(file.fsPath);
                    vscode.workspace.openTextDocument(file).then(doc => {
                        analyzeDocument(doc);
                    });
                }
            });
        });
    }
}

function handleDocumentChange(document: vscode.TextDocument) {
    if (document.languageId !== 'typescript') {
        return;
    }

    if (!scannedFiles.has(document.fileName)) {
        analyzeDocument(document);
        scannedFiles.add(document.fileName);
    } else {
        updateUsages(document);
    }
}

function analyzeDocument(document: vscode.TextDocument) {
    const sourceFile = ts.createSourceFile(
        document.fileName,
        document.getText(),
        ts.ScriptTarget.Latest,
        true
    );

    const localWarnings: { [key: string]: { range: vscode.Range, usages: vscode.Range[] } } = {};

    function visit(node: ts.Node) {
        if (ts.isFunctionDeclaration(node) && node.name) {
            const comments = ts.getLeadingCommentRanges(sourceFile.getFullText(), node.pos);
            if (comments) {
                for (const comment of comments) {
                    const commentText = sourceFile.getFullText().substring(comment.pos, comment.end);
                    if (commentText.includes('@warning')) {
                        const functionName = node.name.getText(sourceFile);
                        const range = new vscode.Range(
                            document.positionAt(node.getStart(sourceFile)),
                            document.positionAt(node.getEnd())
                        );
                        localWarnings[functionName] = { range: range, usages: [] };
                    }
                }
            }
        }
        ts.forEachChild(node, visit);
    }

    visit(sourceFile);
    updateWarnings(localWarnings);
    updateAllUsages(document);
    updateDecorations(document);
}

function updateWarnings(localWarnings: { [key: string]: { range: vscode.Range, usages: vscode.Range[] } }) {
    Object.keys(localWarnings).forEach(functionName => {
        if (!(functionName in warnings)) {
            warnings[functionName] = localWarnings[functionName];
        }
    });
}

function updateAllUsages(document: vscode.TextDocument) {
    const text = document.getText();
    Object.keys(warnings).forEach(functionName => {
        const regex = new RegExp(`\\b\\w*\\.?${functionName}\\s*<.*?>?\\s*\\(`, 'g');
        const usages: vscode.Range[] = [];
        let match;
        while (match = regex.exec(text)) {
            const startPos = document.positionAt(match.index);
            const endPos = document.positionAt(match.index + match[0].length - 1);
            const range = new vscode.Range(startPos, endPos);
            usages.push(range);
        }
        warnings[functionName].usages = usages;
    });

    updateDecorations(document);
}

function updateUsages(document: vscode.TextDocument) {
    const text = document.getText();
    Object.keys(warnings).forEach(functionName => {
        const regex = new RegExp(`\\b\\w*\\.?${functionName}\\s*<.*?>?\\s*\\(`, 'g');
        const usages: vscode.Range[] = [];
        let match;
        while (match = regex.exec(text)) {
            const startPos = document.positionAt(match.index);
            const endPos = document.positionAt(match.index + match[0].length - 1);
            const range = new vscode.Range(startPos, endPos);
            usages.push(range);
        }
        warnings[functionName].usages = usages;
    });

    updateDecorations(document);
}

function updateDecorations(document: vscode.TextDocument) {
    const editor = vscode.window.visibleTextEditors.find(e => e.document.fileName === document.fileName);
    if (editor) {
        const decorations: vscode.DecorationOptions[] = [];
        Object.keys(warnings).forEach(functionName => {
            decorations.push(...warnings[functionName].usages.map(range => ({ range })));
        });
        editor.setDecorations(warningDecorationType, decorations);
    }
}

export function deactivate() {
    if (warningDecorationType) {
        warningDecorationType.dispose();
    }
}
