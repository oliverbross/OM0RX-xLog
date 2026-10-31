import { invoke } from "@tauri-apps/api/core";
import metadata from "../../package.json";
import appLogo from "../assets/xlog-logo-mark.png";
import "./AboutSurface.css";

/** Static product metadata only: no worker, settings, station or account read. */
export function AboutSurface() {
  return <main className="about-xlog" aria-label="About OM0RX-xLog">
    <img src={appLogo} width={192} height={192} alt="OM0RX-xLog logbook icon" />
    <h1>OM0RX-xLog</h1><p>Version {metadata.version}</p>
    <p><strong>Oliver Bross · OM0RX</strong><br /><a href="mailto:oliver@bross.eu">oliver@bross.eu</a></p>
    <p>Send questions, ideas for improvements, and bug reports by email.</p>
    <button type="button" onClick={() => void invoke("close_about_window")}>Close</button>
  </main>;
}
