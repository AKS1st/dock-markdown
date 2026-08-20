import type { IncomingMessage, ServerResponse } from 'node:http';
export declare const name = "dock-markdown";
/** Services required before mounting. */
export declare const inject: string[];
type WbErrorCode = 'bad-request' | 'forbidden' | 'fs-error' | 'not-found' | 'internal' | 'too-large';
export declare class WbError extends Error {
    readonly code: WbErrorCode;
    readonly status: number;
    constructor(code: WbErrorCode, message: string, status?: number);
}
interface WbContext {
    webServer: {
        register(options: {
            kind: 'prefix';
            path: string;
            handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>;
        }): () => void;
    };
    sessions: {
        get(sessionId: string): {
            header: {
                cwd?: string;
            };
        } | undefined;
    };
    webRuntime: {
        trustedHosts: readonly string[];
    };
    effect(fn: () => void | (() => void), label?: string): void;
}
export declare function apply(ctx: WbContext): void;
export {};
