import * as vscode from 'vscode';
import * as ts from 'typescript';

let warningDecorationType: vscode.TextEditorDecorationType;

export function activate(context: vscode.ExtensionContext) {
    warningDecorationType = vscode.window.createTextEditorDecorationType({
        color: 'red', // 将字体颜色变为红色
        fontWeight: 'bold', // 加粗字体
        overviewRulerColor: 'red',
        overviewRulerLane: vscode.OverviewRulerLane.Right,
    });

    vscode.workspace.onDidOpenTextDocument(handleDocumentChange, null, context.subscriptions);
    vscode.workspace.onDidChangeTextDocument(event => handleDocumentChange(event.document), null, context.subscriptions);
    vscode.window.onDidChangeActiveTextEditor(editor => {
        if (editor) {
            handleDocumentChange(editor.document);
        }
    }, null, context.subscriptions);

    // 初始加载时处理当前打开的文档
    const activeEditor = vscode.window.activeTextEditor;
    if (activeEditor) {
        handleDocumentChange(activeEditor.document);
    }
}

function handleDocumentChange(document: vscode.TextDocument) {
    if (document.languageId !== 'typescript') {
        return;
    }

    const sourceFile = ts.createSourceFile(
        document.fileName,
        document.getText(),
        ts.ScriptTarget.Latest,
        true
    );

    const warnings: { [key: string]: { range: vscode.Range, usages: vscode.Range[] } } = {};

    // 遍历 AST 树找到被 @warning 标记的函数
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
                        warnings[functionName] = { range: range, usages: [] };
                    }
                }
            }
        }
        ts.forEachChild(node, visit);
    }

    visit(sourceFile);

    // 查找整个工作区中的被警告标记的函数调用
    vscode.workspace.findFiles('**/*.ts', '**/node_modules/**').then(files => {
        console.log('Files found:', files);
        files.forEach(file => {
            vscode.workspace.openTextDocument(file).then(doc => {
                const text = doc.getText();
                for (const functionName in warnings) {
                    const regex = new RegExp(`\\b${functionName}\\b`, 'g');
                    let match;
                    while (match = regex.exec(text)) {
                        const startPos = doc.positionAt(match.index);
                        const endPos = doc.positionAt(match.index + functionName.length);
                        const range = new vscode.Range(startPos, endPos);
                        warnings[functionName].usages.push(range);
                    }
                }

                setDecorations(doc, warnings);
            });
        });
    });
}

function setDecorations(document: vscode.TextDocument, warnings: { [key: string]: { range: vscode.Range, usages: vscode.Range[] } }) {
    const editor = vscode.window.visibleTextEditors.find(e => e.document.fileName === document.fileName);
    if (editor) {
        const decorations: vscode.DecorationOptions[] = [];
        for (const functionName in warnings) {
            decorations.push(...warnings[functionName].usages.map(range => ({ range })));
        }
        editor.setDecorations(warningDecorationType, decorations);
    }
}

export function deactivate() {
    if (warningDecorationType) {
        warningDecorationType.dispose();
    }
}
