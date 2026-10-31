export function homeFrom(value: any): { call: string; lat: number; lon: number; town: string; tz: string };
export function rigFrom(context: any, now?: number): { freq: number; band?: string; mode: string; tx: boolean | null; src: string } | null;
export function connectXLog(): Promise<any>;
export function publicFetch(link: any, input: string, options?: RequestInit): Promise<Response>;
export function updateCluster(context: any, helpers: any, now?: number): void;
export function announceLogChanges(before: any, after: any, announce: (event: any) => void): void;
