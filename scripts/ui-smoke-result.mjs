// A zero exit alone does not prove the browser assertions ran to completion.
export function smokePassed({ successSeen, failureSeen, forcedAfterSuccess, code }) {
  return successSeen && !failureSeen && (code === 0 || forcedAfterSuccess);
}
