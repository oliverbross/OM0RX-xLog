// Pure contest occurrence presentation shared by Cluster and Band Maps.
// Keeping these helpers outside the map view avoids loading its guide UI in data windows.
type ContestSpot = Record<string, unknown>;
const finite = (value: unknown): number | null => typeof value === "number" && Number.isFinite(value) ? value : null;

export function contestBandMapSpotWorked(spot:ContestSpot):boolean{
  return spot.contestDupe===true;
}
export function contestBandMapSpotPending(spot:ContestSpot):boolean{
  const count=contestNeededMultiplierCount(spot);
  return !contestBandMapSpotWorked(spot)&&(count===null||count===0&&spot.contestDupe!==false);
}
export function contestNeededMultiplierCount(spot:ContestSpot):number|null{
  if(typeof spot.contestCountryMultiplier==="boolean"&&typeof spot.contestZoneMultiplier==="boolean")
    return Number(spot.contestCountryMultiplier)+Number(spot.contestZoneMultiplier);
  return finite(spot.contestMultiplierCount);
}
export function contestBandMapMultiplierLabel(spot:ContestSpot):string{
  if(spot.contestCountryMultiplier===true&&spot.contestZoneMultiplier===true)return "C+Z";
  if(spot.contestCountryMultiplier===true&&spot.contestZoneMultiplier===false)return "C";
  if(spot.contestCountryMultiplier===false&&spot.contestZoneMultiplier===true)return "Z";
  if(spot.contestCountryMultiplier===false&&spot.contestZoneMultiplier===false)return "—";
  const count=finite(spot.contestMultiplierCount);return count===null?"?":count===0?"—":String(count);
}
export function contestBandMapSpotColor(spot:ContestSpot):string{
  if(contestBandMapSpotWorked(spot))return "#aeb5b7";
  const multipliers=contestNeededMultiplierCount(spot);
  if(multipliers!==null&&multipliers>1)return "#00e51b";
  if(multipliers===1)return "#ff5267";
  if(multipliers===0&&spot.contestDupe===false)return "#3da5f4";
  return "#d9b56f";
}
