// A minimal LSP client over stdio, enough to drive the server from a test.
import { spawn } from 'node:child_process';
import { once } from 'node:events';

export class LspClient {
    #process;
    #buffer = Buffer.alloc(0);
    #pending = new Map();
    #notifications = [];
    #waiters = [];
    #nextId = 1;

    constructor(serverPath) {
        this.#process = spawn(process.execPath, [serverPath, '--stdio'], {
            stdio: ['pipe', 'pipe', 'pipe'],
        });
        this.stderr = '';
        this.#process.stderr.on('data', (chunk) => { this.stderr += chunk.toString(); });
        this.#process.stdout.on('data', (chunk) => this.#read(chunk));
    }

    #read(chunk) {
        this.#buffer = Buffer.concat([this.#buffer, chunk]);
        for (;;) {
            const split = this.#buffer.indexOf('\r\n\r\n');
            if (split < 0) return;
            const header = this.#buffer.subarray(0, split).toString('ascii');
            const length = Number(/Content-Length: (\d+)/i.exec(header)?.[1]);
            if (!Number.isFinite(length) || this.#buffer.length < split + 4 + length) return;
            const body = JSON.parse(this.#buffer.subarray(split + 4, split + 4 + length).toString('utf8'));
            this.#buffer = this.#buffer.subarray(split + 4 + length);
            this.#dispatch(body);
        }
    }

    #dispatch(message) {
        if (message.id !== undefined && this.#pending.has(message.id)) {
            const { resolve, reject } = this.#pending.get(message.id);
            this.#pending.delete(message.id);
            if (message.error) reject(new Error(message.error.message));
            else resolve(message.result);
            return;
        }
        if (message.method) {
            this.#notifications.push(message);
            for (const waiter of [...this.#waiters]) {
                if (!waiter.match(message)) continue;
                this.#waiters.splice(this.#waiters.indexOf(waiter), 1);
                waiter.resolve(message);
            }
        }
    }

    #send(message) {
        const text = JSON.stringify(message);
        this.#process.stdin.write(`Content-Length: ${Buffer.byteLength(text, 'utf8')}\r\n\r\n${text}`);
    }

    request(method, params) {
        const id = this.#nextId;
        this.#nextId += 1;
        return new Promise((resolve, reject) => {
            this.#pending.set(id, { resolve, reject });
            this.#send({ jsonrpc: '2.0', id, method, params });
        });
    }

    notify(method, params) {
        this.#send({ jsonrpc: '2.0', method, params });
    }

    /** Resolves with the first notification matching `match`, past or future. */
    waitFor(match, timeout = 10000) {
        const seen = this.#notifications.find(match);
        if (seen) return Promise.resolve(seen);
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error('timed out waiting for a notification')), timeout);
            this.#waiters.push({
                match,
                resolve: (message) => { clearTimeout(timer); resolve(message); },
            });
        });
    }

    /** Drops notifications received so far, so the next wait sees fresh ones. */
    clear() {
        this.#notifications.length = 0;
    }

    async initialize(rootUri) {
        const result = await this.request('initialize', {
            processId: process.pid,
            rootUri,
            workspaceFolders: [{ uri: rootUri, name: 'workspace' }],
            capabilities: {
                textDocument: {
                    publishDiagnostics: {},
                    semanticTokens: { tokenTypes: [], tokenModifiers: [], formats: ['relative'] },
                    documentSymbol: { hierarchicalDocumentSymbolSupport: true },
                },
                workspace: { workspaceFolders: true },
            },
        });
        this.notify('initialized', {});
        return result;
    }

    async stop() {
        this.#process.kill();
        await once(this.#process, 'close');
    }
}
