import SharedPropagationConditions from "./SharedPropagationConditions";
import "./DetachedReferenceSurface.css";

export function DetachedPropagationSurface() {
  return <div className="app live detached-reference-app detached-propagation-app"><main aria-label="Detached Propagation">
    <SharedPropagationConditions includeWeather={false} />
  </main></div>;
}
