import { invoke } from "@tauri-apps/api/core";
import { validRotorSnapshot, type RotorOwner, type RotorSnapshot } from "./rotorControl";

/** Stop never waits for a device read. The native owner revokes automatic turns
 * and checks the same owner at admission; an uncertain reply is never replayed. */
export async function nativeRotorStop(owner: RotorOwner): Promise<RotorSnapshot> {
  const reply: any = await invoke("monitor_rotor_stop", { owner });
  if (reply?.ok !== true || !validRotorSnapshot(reply.result) || reply.result.owner !== owner)
    throw new Error(reply?.error?.message || "Rotor Stop was not acknowledged. Check the observed state before trying again.");
  return reply.result;
}
