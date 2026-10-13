// Import the actual CSS modules eagerly so Vite deduplicates imports from
// lazy surfaces. CSS @import aggregation would duplicate their rules in later
// chunks, overriding the shared typography and layout corrections in live.css.
import "./live/ClusterPanel.css";
import "./live/OpportunitiesPanel.css";
import "./live/data-management.css";
import "./live/logbook.css";
import "./live/AgentConfiguration.css";
import "./live/StationPanel.css";
import "./live/DirectFlexPanel.css";
import "./live/BandMaps.css";
import "./live/AwardsPanel.css";
import "./live/QSOEditor.css";
import "./live/RotorCompass.css";
import "./live/OperatorDesk.css";
import "./live/CW.css";
import "./live/OperatorWorkspace.css";
import "./live/OperatorCanvas.css";
import "./live/SyncPanel.css";
import "./live/ServiceSettings.css";
import "./live/DisplaySettings.css";
import "./live/StationEquipment.css";
import "./live/RotorPanel.css";
import "./live/SpotBridgePanel.css";
