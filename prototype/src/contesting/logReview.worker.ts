import { compareContestLog, type ReviewOptions, type ReviewQSO, type ReviewSpot, type ReviewReferences } from "./logReview";
self.onmessage = (event: MessageEvent<{qsos:ReviewQSO[];spots:ReviewSpot[];options:ReviewOptions;references:ReviewReferences}>) => {
  try { self.postMessage({result:compareContestLog(event.data.qsos,event.data.spots,event.data.options,event.data.references)}); }
  catch (cause) { self.postMessage({error:cause instanceof Error ? cause.message : String(cause)}); }
};
