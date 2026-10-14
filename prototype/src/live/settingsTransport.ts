import { workerRequest } from "../worker";

export async function requestSettings(method: string, params: Record<string, unknown> = {}) {
  return (await workerRequest(method, params)).result;
}
