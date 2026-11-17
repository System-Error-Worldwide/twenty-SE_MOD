export function resolveDraftTarget(listing, headerMessageId) {
  if (!listing || !Array.isArray(listing.drafts) || listing.truncated !== false || typeof headerMessageId !== 'string' || !headerMessageId) {
    throw new Error('A complete draft list and message ID are required');
  }
  const matches = listing.drafts.filter((draft) => draft.headerMessageId === headerMessageId);
  if (matches.length !== 1) throw new Error('Draft identity is missing or ambiguous');
  return matches[0].target;
}
