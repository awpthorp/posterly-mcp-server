/**
 * The closing note after saving a suggestion as a draft. Shared by the hosted
 * and npm MCP servers.
 *
 * A suggestion that was already turned into a post (for example scheduled
 * from the composer) is not saved again: the API returns that post's real
 * status, which may be scheduled or published, so the note must not call it
 * an unpublished draft.
 */
export function suggestionAcceptNote(alreadySaved: boolean, status: string | null | undefined): string {
  if (!alreadySaved || status === 'draft') {
    return 'This is an unpublished draft. Nothing was scheduled and nothing was published.';
  }
  return status
    ? `This suggestion was already turned into a post with status ${status}. Nothing was changed.`
    : 'This suggestion was already turned into a post that no longer exists. Nothing was changed.';
}
