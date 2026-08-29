// ============================================================================
//  VS Code client
//
//  Starts the Tess language server in a Node process and connects it to every
//  `.tess` document the editor opens.
// ============================================================================
import * as path from 'node:path';
import type { ExtensionContext } from 'vscode';
import { commands, window, workspace } from 'vscode';
import type { LanguageClientOptions, ServerOptions } from 'vscode-languageclient/node';
import { LanguageClient, TransportKind } from 'vscode-languageclient/node';

let client: LanguageClient | undefined;

export async function activate(context: ExtensionContext): Promise<void> {
    client = createClient(context);
    context.subscriptions.push(
        commands.registerCommand('tess.restartServer', async () => {
            await client?.stop();
            client = createClient(context);
            await client.start();
            window.showInformationMessage('Tess 언어 서버를 다시 시작했습니다.');
        }),
    );
    await client.start();
}

export async function deactivate(): Promise<void> {
    await client?.stop();
    client = undefined;
}

function createClient(context: ExtensionContext): LanguageClient {
    const module = context.asAbsolutePath(path.join('out', 'server.cjs'));
    const serverOptions: ServerOptions = {
        run: { module, transport: TransportKind.ipc },
        debug: {
            module,
            transport: TransportKind.ipc,
            options: { execArgv: ['--nolazy', '--inspect=6009'] },
        },
    };
    const clientOptions: LanguageClientOptions = {
        documentSelector: [
            { scheme: 'file', language: 'tess' },
            { scheme: 'untitled', language: 'tess' },
        ],
        synchronize: {
            fileEvents: workspace.createFileSystemWatcher('**/*.tess'),
        },
    };
    return new LanguageClient('tess', 'Tess Language Server', serverOptions, clientOptions);
}
