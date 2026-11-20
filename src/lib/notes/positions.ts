// Where a new cell goes in a note (pure: shared by the page, the agent and the tests).

/**
 * The position after a note's last cell. Not the count: once a cell is deleted the positions have a
 * gap, and a new cell at the count would share a position with the last one (the reported bug: two
 * cells at position 1, so their order, and the agent's cell numbers, could swap).
 */
export const endPosition = (cells: readonly { position: number }[]) => cells.reduce((m, c) => Math.max(m, c.position + 1), 0);
