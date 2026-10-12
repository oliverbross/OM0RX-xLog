import type { BandMapViewPreferences } from "./BandMaps";

const sameList = (left: readonly string[] | undefined, right: readonly string[] | undefined) =>
  left === right || !!left && !!right && left.length === right.length && left.every((value, index) => value === right[index]);

export function sameBandMapPreferences(left: BandMapViewPreferences, right: BandMapViewPreferences): boolean {
  return sameList(left.bands, right.bands) && left.followRadio === right.followRadio &&
    left.layout === right.layout && left.fontScale === right.fontScale && sameList(left.modes, right.modes);
}

// A child control emits a complete view based on its last render. Apply only the
// fields that control changed, so two rapid edits cannot revert each other.
export function mergeBandMapPreferenceIntent(
  latest: BandMapViewPreferences, rendered: BandMapViewPreferences, requested: BandMapViewPreferences,
): BandMapViewPreferences {
  return {
    bands: sameList(rendered.bands, requested.bands) ? latest.bands : requested.bands,
    followRadio: rendered.followRadio === requested.followRadio ? latest.followRadio : requested.followRadio,
    layout: rendered.layout === requested.layout ? latest.layout : requested.layout,
    fontScale: rendered.fontScale === requested.fontScale ? latest.fontScale : requested.fontScale,
    ...{ modes: sameList(rendered.modes, requested.modes) ? latest.modes : requested.modes },
  };
}
